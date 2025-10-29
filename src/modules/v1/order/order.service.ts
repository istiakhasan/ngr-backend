import { HttpStatus, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Order } from './entities/order.entity';

import { Products } from './entities/products.entity';
import paginationHelpers from '../../../helpers/paginationHelpers';
import { plainToInstance } from 'class-transformer';
import { generateUniqueOrderNumber } from '../../../util/genarateUniqueNumber';
import { Product } from '../product/entity/product.entity';
import { OrderStatus } from '../status/entities/status.entity';
import { Customers } from '../customers/entities/customers.entity';
import { In } from 'typeorm';
import { Users } from '../user/entities/user.entity';
import { ApiError } from '../../../middleware/ApiError';
import { PaymentHistory } from './entities/paymentHistory.entity';
import { OrdersLog } from './entities/orderlog.entity';
import { Organization } from '../organization/entities/organization.entity';
import { Inventory } from '../inventory/entities/inventory.entity';
import { InventoryItem } from '../inventory/entities/inventoryitem.entity';
import { DataSource } from 'typeorm';
import { RequisitionService } from '../requsition/requsition.service';
import axios from 'axios';
import { DeliveryPartner } from '../delivery-partner/entities/delivery-partner.entity';
import { CustomerService } from '../customers/customers.service';
@Injectable()
export class OrderService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Product)
    private readonly productRepository: Repository<Product>,
    @InjectRepository(OrderStatus)
    private readonly statusRepository: Repository<OrderStatus>,
    @InjectRepository(Customers)
    private readonly customerRepository: Repository<Customers>,
    private readonly customerService: CustomerService,
    @InjectRepository(Users)
    private readonly usersRepository: Repository<Users>,
    @InjectRepository(Products)
    private readonly productsRepository: Repository<Products>,
    @InjectRepository(PaymentHistory)
    private readonly paymentHistoryRepository: Repository<PaymentHistory>,
    @InjectRepository(OrdersLog)
    private readonly orderLogsRepository: Repository<OrdersLog>,
    @InjectRepository(Organization)
    private readonly organizationRepository: Repository<Organization>,
    @InjectRepository(Inventory)
    private readonly inventoryRepository: Repository<Inventory>,
    @InjectRepository(InventoryItem)
    private readonly InventoryItemItemRepository: Repository<InventoryItem>,
    @InjectRepository(DeliveryPartner)
    private readonly deliveryPartnerRepository: Repository<DeliveryPartner>,

    private readonly requisitionService: RequisitionService,
  ) {}

 async createOrder(payload: Order, organizationId: string) {
  const {
    customerId,
    receiverPhoneNumber,
    receiverName,
    receiverDivision,
    receiverDistrict,
    receiverThana,
    receiverAddress,
    products,
    discount = 0,
    paymentHistory = [],
    shippingCharge = 0,
    ...rest
  } = payload;

  if (!products || products.length === 0) {
    throw new Error('Order must include at least one product');
  }

  if (
    !organizationId ||
    !(await this.organizationRepository.findOne({ where: { id: organizationId } }))
  ) {
    throw new ApiError(HttpStatus.BAD_REQUEST, 'You are not authorized');
  }

  // 🟢 Step 1: Ensure Customer Exists (Create if not)
  let finalCustomerId = customerId;

  if (!finalCustomerId) {
    if (!receiverPhoneNumber || !receiverName) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Receiver name and phone number are required');
    }

    // check if a customer already exists with same phone
    let existingCustomer = await this.customerRepository.findOne({
      where: { customerPhoneNumber: receiverPhoneNumber },
    });

    if (!existingCustomer) {
      const newCustomerData = {
        customerName: receiverName,
        customerPhoneNumber: receiverPhoneNumber,
        division: receiverDivision,
        district: receiverDistrict,
        thana: receiverThana,
        address: receiverAddress,
        customerType: 'NON_PROBASHI',
      } as Customers;

      const newCustomer = await this.customerService.createCustomer(newCustomerData);
      existingCustomer = newCustomer;
    }

    finalCustomerId = existingCustomer.customer_Id;
  }

  // 🟢 Step 2: Generate unique order number
  const orderNumber = generateUniqueOrderNumber();
  const validatedProducts: any[] = [];
  let productValue = 0;

  // 🟢 Step 3: Validate and calculate product totals
  for (const product of products) {
    const existingProduct = await this.productRepository.findOne({
      where: { id: product.productId },
    });
    if (!existingProduct) {
      throw new NotFoundException(`Product with ID ${product.productId} not found`);
    }

    const subtotal = product.productQuantity * existingProduct.salePrice;
    productValue += subtotal;

    validatedProducts.push({
      productId: product.productId,
      productQuantity: product.productQuantity,
      productPrice: existingProduct.salePrice,
      subtotal,
    });
  }

  const totalPaidAmount = paymentHistory.reduce(
    (total, payment) => total + Number(payment.paidAmount),
    0,
  );
  const grandTotal = productValue + Number(shippingCharge) - Number(discount);
  const totalReceivableAmount = grandTotal - totalPaidAmount;

  // 🟢 Step 4: Generate invoice number
  const lastOrder = await this.orderRepository
    .createQueryBuilder('order')
    .orderBy('order.createdAt', 'DESC')
    .take(1)
    .getOne();

  const lastUserId = lastOrder?.invoiceNumber?.substring(3);
  const currentId = lastUserId || (0).toString().padStart(4, '0');
  let incrementedId = (parseInt(currentId) + 1).toString().padStart(4, '0');
  incrementedId = `SO-${incrementedId}`;

  // 🟢 Step 5: Save order
  const result = await this.orderRepository.save({
    orderNumber,
    paymentHistory,
    customerId: finalCustomerId,
    receiverPhoneNumber,
    receiverName,
    receiverDivision,
    receiverDistrict,
    receiverThana,
    receiverAddress,
    currier: payload.currier,
    orderSource: payload.orderSource,
    shippingCharge,
    totalPrice: grandTotal,
    productValue,
    totalPaidAmount,
    totalReceiveAbleAmount: totalReceivableAmount,
    discount,
    invoiceNumber: incrementedId,
    organizationId,
    products: validatedProducts,
    ...rest,
  });

  // 🟢 Step 6: Log creation
  await this.orderLogsRepository.save({
    orderId: result.id,
    agentId: payload.agentId,
    action: 'The Order created',
    previousValue: null,
  });

  // 🟢 Step 7: Update inventory if not status 1
  if (rest?.statusId !== 1) {
    for (const item of products) {
      const { productId, productQuantity } = item;
      const existingInventory = await this.inventoryRepository.findOne({ where: { productId } });

      if (!existingInventory?.orderQue) {
        await this.inventoryRepository.update({ productId }, { orderQue: 0 });
      }
      await this.inventoryRepository.increment({ productId }, 'orderQue', productQuantity);

      const existingInventoryItem = await this.InventoryItemItemRepository.findOne({
        where: { productId, locationId: rest?.locationId },
      });

      if (!existingInventoryItem) {
        const newInventoryItems = this.InventoryItemItemRepository.create({
          locationId: rest?.locationId,
          productId,
          quantity: 0,
          orderQue: productQuantity,
          inventoryId: existingInventory.id,
        });
        await this.InventoryItemItemRepository.save(newInventoryItems);
      } else {
        if (!existingInventoryItem?.orderQue) {
          await this.InventoryItemItemRepository.update(
            { productId, locationId: rest?.locationId },
            { orderQue: 0 },
          );
        }
        await this.InventoryItemItemRepository.increment(
          { productId, locationId: rest?.locationId },
          'orderQue',
          productQuantity,
        );
      }
    }
  }

  return result;
}


 async getOrders(options, filterOptions, organizationId) {
  const { page, limit, sortBy, sortOrder, skip } = paginationHelpers(options);

  const qb = this.orderRepository
    .createQueryBuilder('orders')
    .where('orders.organizationId = :organizationId', { organizationId });

  // ----- Helper Functions -----
  const toArray = (value: any) => (Array.isArray(value) ? value : [value]);
  const safeFindBy = async (repo, field, values) =>
    values.length ? await repo.findBy({ [field]: In(values) }) : [];

  // ----- Filters -----
  if (filterOptions?.searchTerm) {
    qb.andWhere('orders.orderNumber LIKE :searchTerm', {
      searchTerm: `%${filterOptions.searchTerm}%`,
    });
  }

  if (filterOptions?.startDate && filterOptions?.endDate) {
    qb.andWhere('orders.intransitTime BETWEEN :startDate AND :endDate', {
      startDate: new Date(filterOptions.startDate),
      endDate: new Date(filterOptions.endDate),
    });
  }

  if (filterOptions?.statusId) {
    const ids = toArray(filterOptions.statusId).map(Number);
    qb.andWhere('orders.statusId IN (:...ids)', { ids });
  }

  if (filterOptions?.currier) {
    const ids = toArray(filterOptions.currier);
    qb.andWhere('orders.currier IN (:...ids)', { ids });
  }

  if (filterOptions?.locationId) {
    const ids = toArray(filterOptions.locationId);
    qb.andWhere('orders.locationId IN (:...ids)', { ids });
  }

  qb.orderBy(`orders.${sortBy}`, sortOrder).skip(skip).take(limit);

  // ----- Fetch Orders -----
  const [orders, total] = await qb.getManyAndCount();
  if (!orders.length) {
    return { data: [], total, page, limit };
  }

  // ----- Prepare Related IDs -----
  const unique = (arr: any[]) => [...new Set(arr.filter(Boolean))];
  const statusIds = unique(orders.map(o => o.statusId));
  const currierIds = unique(orders.map(o => o.currier));
  const customerIds = unique(orders.map(o => o.customerId));
  const agentIds = unique(orders.map(o => o.agentId));

  // ----- Parallel Data Fetch (Performance Boost 🚀) -----
  const [statuses, partners, customers, agents] = await Promise.all([
    safeFindBy(this.statusRepository, 'value', statusIds),
    safeFindBy(this.deliveryPartnerRepository, 'id', currierIds),
    safeFindBy(this.customerRepository, 'customer_Id', customerIds),
    safeFindBy(this.usersRepository, 'userId', agentIds),
  ]);

  // ----- Create Maps for Fast Lookup -----
  const statusMap = new Map(statuses.map(s => [s.value, s]));
  const partnerMap = new Map(
    partners.map(({ secret_key, api_key, ...p }) => [p.id, p]),
  );
  const customerMap = new Map(customers.map(c => [c.customer_Id, c]));
  const agentMap = new Map(agents.map(a => [a.userId, a]));

  // ----- Combine Final Response -----
  const data = orders.map(order => ({
    ...order,
    status: statusMap.get(order.statusId),
    customer: customerMap.get(order.customerId),
    agent: agentMap.get(order.agentId),
    partner: partnerMap.get(order.currier),
  }));

  return {
    data: plainToInstance(Order, data),
    total,
    page,
    limit,
  };
}


  async getOrderById(orderId: number): Promise<Order & { partner: any }> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['paymentHistory', 'comments', 'comments.user'],
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }

    if (order.comments && order.comments.length > 0) {
      order.comments.sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
    }

    const [products, customer] = await Promise.all([
      this.productsRepository.find({
        where: { orderId: order.id },
        relations: ['product'],
      }),
      this.customerRepository.findOne({
        where: { customer_Id: order.customerId },
      }),
    ]);

    if (!customer) {
      throw new NotFoundException(
        `Customer with ID ${order.customerId} not found`,
      );
    }

    return {
      ...order,
      products: products || [],
      customer,
      partner: await this.deliveryPartnerRepository.findOne({
        where: { id: order?.currier },
      }),
    };
  }

  /**
   * Delete an order by its ID.
   */
  async deleteOrder(orderId: number): Promise<void> {
    const result = await this.orderRepository.delete(orderId);

    if (result.affected === 0) {
      throw new NotFoundException(`Order with ID ${orderId} not found`);
    }
  }

  async update(orderId: number, data: Order) {
    const {
      customerId,
      receiverPhoneNumber,
      products,
      discount = 0,
      shippingCharge = 0,
      ...rest
    } = data;

    const existingOrder = await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['products'],
    });
    if (!existingOrder) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Order does not exist');
    }

    if (!products || products.length === 0) {
      throw new Error('Order must include at least one product');
    }

    const existingProducts = await this.productsRepository.find({
      where: { orderId },
    });

    const validatedProducts: any[] = [];
    let productValue = 0;

    for (const product of products) {
      const existingProduct = await this.productRepository.findOne({
        where: { id: product.productId },
      });
      if (!existingProduct) {
        throw new NotFoundException(
          `Product with ID ${product.productId} not found`,
        );
      }

      // Find previous product quantity
      const prevProduct = existingProducts.find(
        (p) => p.productId === product.productId,
      );
      const prevQuantity = prevProduct ? prevProduct.productQuantity : 0;
      const quantityDiff = product.productQuantity - prevQuantity;

      if (existingOrder.statusId === 2) {
        // Adjust stock based on change in order quantity
        const inventory = await this.inventoryRepository.findOne({
          where: { productId: product.productId },
        });

        const inventoryItem = await this.InventoryItemItemRepository.findOne({
          where: {
            productId: product.productId,
            locationId: existingOrder.locationId,
          },
        });

        if (inventory) {
          await this.inventoryRepository.update(
            { productId: product.productId },
            { orderQue: inventory.orderQue + quantityDiff },
          );
        }

        if (inventoryItem) {
          await this.InventoryItemItemRepository.update(
            {
              productId: product.productId,
              locationId: existingOrder.locationId,
            },
            { orderQue: inventoryItem.orderQue + quantityDiff },
          );
        }
      }
      if (
        (existingOrder.statusId === 5 &&
          existingOrder.status.label === 'Store') ||
        existingOrder.statusId === 6
      ) {
        // Adjust stock based on change in order quantity
        const inventory = await this.inventoryRepository.findOne({
          where: { productId: product.productId },
        });

        const inventoryItem = await this.InventoryItemItemRepository.findOne({
          where: {
            productId: product.productId,
            locationId: existingOrder.locationId,
          },
        });

        if (inventory) {
          await this.inventoryRepository.update(
            { productId: product.productId },
            { processing: inventory.processing + quantityDiff },
          );
        }

        if (inventoryItem) {
          await this.InventoryItemItemRepository.update(
            {
              productId: product.productId,
              locationId: existingOrder.locationId,
            },
            { processing: inventoryItem.processing + quantityDiff },
          );
        }
      }

      // Calculate new subtotal
      const subtotal = product.productQuantity * existingProduct.salePrice;
      productValue += subtotal;
      validatedProducts.push({
        orderId,
        productId: product.productId,
        productQuantity: product.productQuantity,
        productPrice: existingProduct.salePrice,
        subtotal,
      });
    }

    // Delete old products & insert new ones
    await this.productsRepository.delete({ orderId });
    if (validatedProducts.length > 0) {
      await this.productsRepository.save(validatedProducts);
    }

    // Log the update
    await this.orderLogsRepository.save({
      orderId: orderId,
      agentId: data.agentId,
      action: `Order updated. Products and other information (e.g., shipping charge, customer details) have been modified.`,
      previousValue: existingOrder ? JSON.stringify(existingOrder) : null,
      newValue: JSON.stringify(data),
    });

    // Calculate totals
    const grandTotal = productValue + Number(shippingCharge) - Number(discount);
    const totalReceivableAmount = grandTotal - rest.totalPaidAmount;

    // Update order
    await this.orderRepository.update(
      { id: orderId },
      {
        ...rest,
        customerId,
        receiverPhoneNumber,
        discount,
        shippingCharge,
        totalPrice: grandTotal,
        productValue,
        totalReceiveAbleAmount: totalReceivableAmount,
      },
    );

    // Return updated order
    return await this.orderRepository.findOne({
      where: { id: orderId },
      relations: ['products'],
    });
  }

  // update payment
  async addPayment(orderId: number, data: PaymentHistory) {
    const isOrderExist = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!isOrderExist) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Order is not exist ');
    }
    const previousHistory = await this.paymentHistoryRepository.find({
      where: { orderId: orderId },
    });

    const insertPayment = await this.paymentHistoryRepository.save(data);
    if (!insertPayment) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Payment is not added ');
    }

    const totalPaidAmount = [...previousHistory, data].reduce(
      (total, payment) => total + Number(payment.paidAmount),
      0,
    );
    const grandTotal =
      Number(isOrderExist.productValue) +
      Number(isOrderExist.shippingCharge) -
      Number(isOrderExist.discount);
    const totalReceivableAmount = grandTotal - totalPaidAmount;
    await this.orderRepository.update(
      {
        id: orderId,
      },
      {
        totalPaidAmount,
        totalReceiveAbleAmount: totalReceivableAmount,
        paymentStatus: data?.paymentStatus,
      },
    );
    await this.orderLogsRepository.save({
      orderId: orderId,
      agentId: data.userId,
      action: `A payment with status '${data.paymentStatus}' was added using the '${data.paymentMethod}' method.`,
      previousValue:
        previousHistory?.length > 0 ? JSON.stringify(previousHistory[0]) : null,
      newValue: JSON.stringify(data),
    });
    return this.orderRepository.findOne({ where: { id: orderId } });
  }

  async changeStatusBulk(
    orderIds: number[],
    mainData: any,
    organizationId: string,
  ) {
    const { currentStatus, ...data } = mainData;
    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: ['status'],
    });

    if (orders.length !== orderIds.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Some orders do not exist');
    }

    //status change to intransit , in-transit order status===7
    if (data?.statusId === 7) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const currierPayload = orders?.map((op: any) => {
          return {
            invoice: op?.invoiceNumber,
            recipient_name: op?.receiverName,
            recipient_phone: op?.receiverPhoneNumber,
            recipient_address: op?.receiverAddress,
            cod_amount: op?.totalReceiveAbleAmount,
            note: op?.deliveryNote || 'N/A',
          };
        });

        const productUpdates = [];
        for (const order of orders) {
          const products = await this.productsRepository.find({
            where: { orderId: order.id },
          });

          for (const product of products) {
            const inventory = await this.inventoryRepository.findOne({
              where: { productId: product.productId },
            });

            const inventoryItem =
              await this.InventoryItemItemRepository.findOne({
                where: {
                  productId: product.productId,
                  locationId: order.locationId,
                },
              });

            if (inventory) {
              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  processing: inventory.processing - product.productQuantity,
                  stock: inventory.stock - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  processing:
                    inventoryItem.processing - product.productQuantity,
                  quantity: inventoryItem.quantity - product.productQuantity,
                },
              );
            }
          }
        }

        const currierCompany = await this.deliveryPartnerRepository.findOne({
          where: { organizationId: organizationId, id: orders[0]?.currier },
        });

        if (currierCompany?.partnerName === 'SteadFast') {
          await Promise.all(productUpdates);
          await axios.post(
            'https://portal.packzy.com/api/v1/create_order/bulk-order',
            currierPayload,
            {
              headers: {
                'Api-Key': currierCompany.api_key,
                'Secret-Key': currierCompany.secret_key,
              },
            },
          );
        }
        await this.orderRepository.update(
          { id: In(orderIds) },
          { intransitTime: new Date() },
        );
        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new ApiError(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message || 'Failed to update inventory',
        );
      } finally {
        await queryRunner.release();
      }
    }
    //status change to store , store order status===5
    if (data?.statusId === 5) {
      await this.requisitionService.createRequisition(
        { orderIds, userId: data?.userId },
        organizationId,
      );
      await this.orderRepository.update(
        { id: In(orderIds) },
        { storeTime: new Date() },
      );
    }
    if (data?.statusId === 6) {
      await this.orderRepository.update(
        { id: In(orderIds) },
        { packingTime: new Date() },
      );
    }
    if (data?.statusId === 4 && currentStatus === 2) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const productUpdates = [];
        for (const order of orders) {
          const products = await this.productsRepository.find({
            where: { orderId: order.id },
          });

          for (const product of products) {
            const inventory = await this.inventoryRepository.findOne({
              where: { productId: product.productId },
            });

            const inventoryItem =
              await this.InventoryItemItemRepository.findOne({
                where: {
                  productId: product.productId,
                  locationId: order.locationId,
                },
              });

            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     orderQue: inventory.orderQue - product.productQuantity
              //   })
              // );

              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  orderQue: inventory.orderQue - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     orderQue: inventoryItem.orderQue - product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  orderQue: inventoryItem.orderQue - product.productQuantity,
                },
              );
            }
          }
        }

        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new ApiError(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message || 'Failed to update inventory',
        );
      } finally {
        await queryRunner.release();
      }
    }

    if (data?.statusId === 4 && (currentStatus === 5 || currentStatus === 6)) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const productUpdates = [];
        for (const order of orders) {
          const products = await this.productsRepository.find({
            where: { orderId: order.id },
          });

          for (const product of products) {
            const inventory = await this.inventoryRepository.findOne({
              where: { productId: product.productId },
            });

            const inventoryItem =
              await this.InventoryItemItemRepository.findOne({
                where: {
                  productId: product.productId,
                  locationId: order.locationId,
                },
              });

            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     processing: inventory.processing - product.productQuantity
              //   })
              // );

              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  processing: inventory.processing - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     processing: inventoryItem.processing - product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  processing:
                    inventoryItem.processing - product.productQuantity,
                },
              );
            }
          }
        }

        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new ApiError(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message || 'Failed to update inventory',
        );
      } finally {
        await queryRunner.release();
      }
    }

    // change hold status

    if (data?.statusId === 3 && currentStatus === 2) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const productUpdates = [];
        for (const order of orders) {
          const products = await this.productsRepository.find({
            where: { orderId: order.id },
          });

          for (const product of products) {
            const inventory = await this.inventoryRepository.findOne({
              where: { productId: product.productId },
            });

            const inventoryItem =
              await this.InventoryItemItemRepository.findOne({
                where: {
                  productId: product.productId,
                  locationId: order.locationId,
                },
              });

            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     orderQue: inventory.orderQue - product.productQuantity,
              //     hoildQue:inventory.hoildQue+product.productQuantity
              //   })
              // );
              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  orderQue: inventory.orderQue - product.productQuantity,
                  hoildQue: inventory.hoildQue + product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     orderQue: inventoryItem.orderQue - product.productQuantity,
              //     hoildQue:inventoryItem.hoildQue+product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  orderQue: inventoryItem.orderQue - product.productQuantity,
                  hoildQue: inventoryItem.hoildQue + product.productQuantity,
                },
              );
            }
          }
        }

        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new ApiError(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message || 'Failed to update inventory',
        );
      } finally {
        await queryRunner.release();
      }
    }

    if (data?.statusId === 3 && (currentStatus === 5 || currentStatus === 6)) {
      const queryRunner = this.dataSource.createQueryRunner();
      await queryRunner.connect();
      await queryRunner.startTransaction();

      try {
        const productUpdates = [];
        for (const order of orders) {
          const products = await this.productsRepository.find({
            where: { orderId: order.id },
          });

          for (const product of products) {
            console.log(product, 'product');
            const inventory = await this.inventoryRepository.findOne({
              where: { productId: product.productId },
            });

            const inventoryItem =
              await this.InventoryItemItemRepository.findOne({
                where: {
                  productId: product.productId,
                  locationId: order.locationId,
                },
              });

            if (inventory) {
              console.log('++++++++++++++++++++++');
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     processing: inventory.processing - product.productQuantity,
              //     hoildQue:inventory.hoildQue+product.productQuantity
              //   })
              // );
              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  processing: inventory.processing - product.productQuantity,
                  hoildQue: inventory.hoildQue + product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              console.log('_________________________');
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     processing: inventoryItem.processing - product.productQuantity,
              //     hoildQue:inventoryItem.hoildQue+product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  processing:
                    inventoryItem.processing - product.productQuantity,
                  hoildQue: inventoryItem.hoildQue + product.productQuantity,
                },
              );
            }
          }
        }
        // Commit transaction
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw new ApiError(
          HttpStatus.INTERNAL_SERVER_ERROR,
          error.message || 'Failed to update inventory',
        );
      } finally {
        await queryRunner.release();
      }
    }

    await this.orderRepository.update(
      { id: In(orderIds) },
      { ...data, previousStatus: currentStatus },
    );

    const updatedOrders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: ['status'],
    });

    const orderLogs = orders.map((order, index) => ({
      orderId: order.id,
      agentId: data.agentId,
      action: `Order Status changed to ${updatedOrders[index].status.label} from ${order.status.label}`,
      previousValue: null,
    }));

    await this.orderLogsRepository.save(orderLogs);

    return updatedOrders;
  }
  // change hold status
  async changeHoldStatus(
    orderIds: number[],
    mainData: any,
    organizationId: string,
  ) {
    const { currentStatus, ...data } = mainData;
    const orders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: ['status'],
    });

    if (orders.length !== orderIds.length) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Some orders do not exist');
    }
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const productUpdates = [];
      for (const order of orders) {
        const products = await this.productsRepository.find({
          where: { orderId: order.id },
        });

        for (const product of products) {
          const inventory = await this.inventoryRepository.findOne({
            where: { productId: product.productId },
          });

          const inventoryItem = await this.InventoryItemItemRepository.findOne({
            where: {
              productId: product.productId,
              locationId: order.locationId,
            },
          });

          if (order?.previousStatus === '2' && data?.statusId !== 4) {
            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     orderQue: inventory.orderQue + product.productQuantity,
              //     hoildQue:inventory.hoildQue-product.productQuantity
              //   })
              // );

              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  orderQue: inventory.orderQue + product.productQuantity,
                  hoildQue: inventory.hoildQue - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     orderQue: inventoryItem.orderQue + product.productQuantity,
              //     hoildQue:inventoryItem.hoildQue-product.productQuantity
              //   })
              // );

              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  orderQue: inventoryItem.orderQue + product.productQuantity,
                  hoildQue: inventoryItem.hoildQue - product.productQuantity,
                },
              );
            }
          }
          if (
            (order?.previousStatus === '5' || order?.previousStatus === '6') &&
            data?.statusId !== 4
          ) {
            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     processing: inventory.processing + product.productQuantity,
              //     hoildQue:inventory.hoildQue-product.productQuantity
              //   })
              // );

              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  processing: inventory.processing + product.productQuantity,
                  hoildQue: inventory.hoildQue - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     processing: inventoryItem.processing + product.productQuantity,
              //     hoildQue:inventoryItem.hoildQue-product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  processing:
                    inventoryItem.processing + product.productQuantity,
                  hoildQue: inventoryItem.hoildQue - product.productQuantity,
                },
              );
            }
          }
          if (data?.statusId === 4) {
            if (inventory) {
              // productUpdates.push(
              //   queryRunner.manager.update(Inventory, { productId: product.productId }, {
              //     hoildQue:inventory.hoildQue-product.productQuantity
              //   })
              // );

              await this.inventoryRepository.update(
                { productId: product.productId },
                {
                  hoildQue: inventory.hoildQue - product.productQuantity,
                },
              );
            }
            if (inventoryItem) {
              // productUpdates.push(
              //   queryRunner.manager.update(InventoryItem, { productId: product.productId, locationId: order.locationId }, {
              //     hoildQue:inventoryItem.hoildQue-product.productQuantity
              //   })
              // );
              await this.InventoryItemItemRepository.update(
                { productId: product.productId, locationId: order.locationId },
                {
                  hoildQue: inventoryItem.hoildQue - product.productQuantity,
                },
              );
            }
          }
          await this.orderRepository.update(
            { id: order.id },
            { statusId: +order.previousStatus },
          );
        }
      }
      // Commit transaction
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw new ApiError(
        HttpStatus.INTERNAL_SERVER_ERROR,
        error.message || 'Failed to update inventory',
      );
    } finally {
      await queryRunner.release();
    }

    // await this.orderRepository.update({ id: In(orderIds) }, data);

    const updatedOrders = await this.orderRepository.find({
      where: { id: In(orderIds) },
      relations: ['status'],
    });

    const orderLogs = orders.map((order, index) => ({
      orderId: order.id,
      agentId: data.agentId,
      action: `Order Status changed to ${updatedOrders[index].status.label} from ${order.status.label}`,
      previousValue: null,
    }));

    await this.orderLogsRepository.save(orderLogs);

    return updatedOrders;
  }

  async getOrdersLogs(orderId: number) {
    const isExist = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!isExist) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Order is not exist');
    }
    return await this.orderLogsRepository.find({
      where: { orderId: orderId },
      relations: ['updatedBy'],
      select: {
        updatedBy: {
          name: true,
        },
      },
      order: { createdAt: 'DESC' },
    });
  }
}
