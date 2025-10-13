import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { plainToInstance } from 'class-transformer';
import paginationHelpers from '../../../helpers/paginationHelpers';
import { Category } from './entity/category.entity';
import { ApiError } from '../../../middleware/ApiError';

@Injectable()
export class CategoryService {
  constructor(
    @InjectRepository(Category)
    private readonly categoryRepository: Repository<Category>,
  ) {}

  async createCategory(payload: Category): Promise<Category> {
    const isExist = await this.categoryRepository.findOne({
      where: { label: payload?.label },
    });
    if (isExist) {
      throw new ApiError(HttpStatus.BAD_REQUEST, 'Category is already in list');
    }
    return await this.categoryRepository.save(payload);
  }

  async getCategory(options, filterOptions) {
    const { page, limit, skip, sortBy, sortOrder } = paginationHelpers(options);

    const queryBuilder = this.categoryRepository
      .createQueryBuilder('categories')
      .leftJoinAndSelect('categories.products', 'products')
      .leftJoinAndSelect('products.images', 'images')
      .take(limit)
      .skip(skip)
      .orderBy(`categories.${sortBy}`, sortOrder);

    // Optional search on category label
    if (filterOptions?.searchTerm) {
      const searchTerm = `%${filterOptions.searchTerm}%`;
      queryBuilder.andWhere('categories.label LIKE :searchTerm', {
        searchTerm,
      });
    }

    const [data, total] = await queryBuilder.getManyAndCount();

    // Automatically includes images in each product (because of eager loading)
    const modifyData = plainToInstance(Category, data);

    return {
      data: modifyData,
      total,
      page,
      limit,
    };
  }

  async getCategoryOptionsAndCount(
    paginationOptions?: any,
    filterOptions?: any,
  ) {
    const { limit, page, sortBy, sortOrder } = paginationOptions || {};

    const queryBuilder = this.categoryRepository
      .createQueryBuilder('category')
      .leftJoin('category.products', 'products')
      .select([
        'category.id AS value',
        'category.label AS label',
        'COUNT(products.id) AS "productCount"',
      ])
      .groupBy('category.id')
      .addGroupBy('category.label');

    if (filterOptions?.searchTerm) {
      queryBuilder.andWhere('category.label ILIKE :searchTerm', {
        searchTerm: `%${filterOptions.searchTerm}%`,
      });
    }

    if (sortBy && sortOrder) {
      queryBuilder.orderBy(
        `category.${sortBy}`,
        sortOrder.toUpperCase() as 'ASC' | 'DESC',
      );
    } else {
      queryBuilder.orderBy('category.createdAt', 'DESC');
    }

    const total = await queryBuilder.getCount();

    if (limit && page) {
      queryBuilder.offset((page - 1) * limit).limit(limit);
    }

    const rows = await queryBuilder.getRawMany();

    const data = rows.map((row) => ({
      label: row.label,
      value: row.value,
      productCount: Number(row.productCount),
    }));

    return {
      data,
      total,
      page: page ? Number(page) : null,
      limit: limit ? Number(limit) : null,
    };
  }

  async getProductById(id: number): Promise<Category> {
    return await this.categoryRepository.findOne({ where: { id } });
  }
  async updateCategoryById(id: number, data: Partial<Category>) {
    const result = await this.categoryRepository.update({ id }, data);
    console.log(result);
    if (result?.affected > 0) {
      return await this.categoryRepository.findOne({ where: { id } });
    } else {
      return null;
    }
  }
}
