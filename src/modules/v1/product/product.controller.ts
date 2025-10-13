import {
  Controller,
  Get,
  Post,
  Param,
  Body,
  UseInterceptors,
  UploadedFiles,
  HttpStatus,
  Query,
  Patch,
  Delete,
  Req
} from '@nestjs/common';
import { ProductService } from './product.service';
import { Product } from './entity/product.entity';
import { ZodPipe } from '../../../middleware/ZodPipe'
import { ProductSchema, VariantProductSchema } from './product.validation';
import { extractOptions } from '../../../helpers/queryHelper';
import { catchAsync } from '../../../hoc/createAsync';
import { IResponse } from 'src/util/sendResponse';

@Controller('v1/products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}
  @Get('/count')
  async countProduct(@Req() req:Request){
    const organizationId=req.headers['x-organization-id']
    return catchAsync(async()=>{
      const result = await this.productService.countProducts(organizationId);
      return {
        success: true,
        message: 'Product count retrieved successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    })
  }

  @Delete('/image/delete')
  async deleteProductImage(@Body() data){
    return catchAsync(async()=>{
      const result = await this.productService.deleteProductImageService(data?.url);
      return {
        success: true,
        message: 'Product count retrieved successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    })
  }
  // @Post()
  // @UseInterceptors(
  //   FileFieldsInterceptor([
  //     { name: 'images', maxCount: 10 },
  //     // { name: 'example', maxCount: 1 },
  //   ]),
  // )
  // async createProduct(
  //   @Body(new ZodPipe(ProductSchema)) data: Omit<Product, 'images'>,
  //   @UploadedFiles() files: { images?: Express.Multer.File[] },
  // ) {
  //   return catchAsync(async ():Promise<IResponse<Product>> => {
  //     if (!files?.images || files.images.length === 0) {
  //       throw new ApiError(HttpStatus.BAD_REQUEST, 'Please select at least one image');
  //     }
  //     const images = await uploadFiles(files.images, './uploads');
  //     const result = await this.productService.createProduct({ ...data, images });
  //     return {
  //       success: true,
  //       message: 'Product created successfully',
  //       statusCode: HttpStatus.OK,
  //       data: result,
  //     };
  //   });
  // }
  @Post()
  async createProduct(
    @Body(new ZodPipe(ProductSchema)) data: Product,
    @Req() req:Request
  ) {
    const organizationId=req.headers['x-organization-id']
    return catchAsync(async ():Promise<IResponse<Product>> => {
      const result = await this.productService.createSimpleProduct({...data,organizationId});
      return {
        success: true,
        message: 'Product created successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    });
  }
  

  @Post('variant')
  async createVariantProduct(
    @Body(new ZodPipe(VariantProductSchema)) data:Product
    ,@Req() req:Request
  ){
    return catchAsync(async ():Promise<IResponse<Product>> => { 
      const organizationId=req.headers['x-organization-id']
      const result = await this.productService.createVariantProduct(data,organizationId);
      return {
        success: true,
        message: 'Product created successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    });
  }
  @Get()
  async getProducts(@Query() query,@Req() req:Request) {
    const organizationId=req.headers['x-organization-id']
    return catchAsync(async ():Promise<IResponse<Product[]>> => {
      console.log(query,"query");
      const paginationOptions = extractOptions(query, ['limit', 'page', 'sortBy', 'sortOrder']);
      const filterOptions = extractOptions(query, ['searchTerm','authorIds', 'filterByCustomerType','badge','categoryId','salesPriceMax','salesPriceMin']);
      const result = await this.productService.getProducts(paginationOptions, filterOptions,organizationId);
      return {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Products retrieved successfully',
        data: result?.data,
        meta: {
          total: result?.total,
          page: result?.page,
          limit: result?.limit,
        },
      };
    });
  }
  

  @Get(':id')
  async getProductById(@Param('id') id: string): Promise<Product> {
    return catchAsync(async () => {

      const result =  await this.productService.getProductById(id);
      return {
        success: true,
        message: 'Product retrieved  successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    });
  }
  @Patch(':id')
  async updateProductById(
    @Param('id') id: string,
    @Body() data: Product,
  ) {
    return catchAsync(async () => {

      const result =  await this.productService.updateProductById(id,data);
      return {
        success: true,
        message: 'Product update  successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    });
  }
}
