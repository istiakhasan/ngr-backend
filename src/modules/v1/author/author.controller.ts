import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  Patch,
  Delete,
} from '@nestjs/common';
import { AuthorService } from './author.service';
import { Author } from './entity/author.entity';


@Controller('v1/authors')
export class AuthorController {
  constructor(private readonly authorService: AuthorService) {}

  // ✅ Create author
  @Post()
  async create(@Body() body: Partial<Author>) {
    return this.authorService.create(body);
  }

  // ✅ Get all authors
  @Get()
  async findAll() {
    return this.authorService.findAll();
  }
  @Get('/options')
  async findAllOptions() {
    return this.authorService.findAllOptions();
  }

  // ✅ Get author by ID
  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.authorService.findOne(id);
  }

  // ✅ Update author
  @Patch(':id')
  async update(@Param('id') id: string, @Body() body: Partial<Author>) {
    return this.authorService.update(id, body);
  }

  // ✅ Delete author
  @Delete(':id')
  async remove(@Param('id') id: string) {
    await this.authorService.remove(id);
    return { message: 'Author deleted successfully' };
  }
}
