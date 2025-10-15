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
  Delete
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ZodPipe } from '../../../middleware/ZodPipe';
import { CategorySchema } from './category.validation';
import { ApiError } from '../../../middleware/ApiError';
import { uploadFiles } from 'src/util/file-upload.util';
import { extractOptions } from '../../../helpers/queryHelper';
import { catchAsync } from '../../../hoc/createAsync';
import { IResponse } from 'src/util/sendResponse';
import { CategoryService } from './category.service';
import { Category } from './entity/category.entity';

@Controller('v1/category')
export class CategoryController {
  constructor(private readonly categoryService: CategoryService) {}

  @Post()
  async createCategory(
    @Body(new ZodPipe(CategorySchema)) data: Category
  ) {
    return catchAsync(async ():Promise<IResponse<Category>> => {
      const result = await this.categoryService.createCategory(data);
      return {
        success: true,
        message: 'Category created successfully',
        statusCode: HttpStatus.OK,
        data: result,
      };
    });
  }
  
  @Get()
  async getProducts(@Query() query) {
    return catchAsync(async ():Promise<IResponse<Category[]>> => {
      const paginationOptions = extractOptions(query, ['limit', 'page', 'sortBy', 'sortOrder']);
      const filterOptions = extractOptions(query, ['searchTerm', 'filterByCustomerType']);
      const result = await this.categoryService.getCategory(paginationOptions, filterOptions);
      return {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Category retrieved successfully',
        data: result?.data,
        meta: {
          total: result?.total,
          page: result?.page,
          limit: result?.limit,
        },
      };
    });
  }
  @Get('/options')
async getCategoryOptionsAndCount(@Query() query) {
  return catchAsync(async (): Promise<IResponse<any>> => {
    const paginationOptions = extractOptions(query, ['limit', 'page', 'sortBy', 'sortOrder']);
    const filterOptions = extractOptions(query, ['searchTerm']);

    const result = await this.categoryService.getCategoryOptionsAndCount(paginationOptions, filterOptions);

    return {
      success: true,
      statusCode: HttpStatus.OK,
      message: 'Category retrieved successfully',
      data: result?.data,
      meta: result?.limit
        ? {
            total: result?.total,
            page: result?.page,
            limit: result?.limit,
          }
        : undefined, // ✅ If no pagination, meta will be skipped
    };
  });
}

  

  @Get(':id')
  async getProductById(@Param('id') id: number): Promise<Category> {
    return await this.categoryService.getProductById(id);
  }
  @Patch(':id')
  async updateCategory(@Param('id') id: number,@Body() data:any) {

    return catchAsync(async ():Promise<IResponse<Category>> => {
      const result = await this.categoryService.updateCategoryById(id,data);
      return {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Category update successfully',
        data: result,
      };
    });
  }
  @Delete(':id')
  async deleteCategory(@Param('id') id: number) {

    return catchAsync(async ():Promise<IResponse<Category>> => {
      const result = await this.categoryService.deleteCategory(id);
      return {
        success: true,
        statusCode: HttpStatus.OK,
        message: 'Category delete successfully',
        data: result,
      };
    });
  }
}
