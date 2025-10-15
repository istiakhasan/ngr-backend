import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Author } from './entity/author.entity';


@Injectable()
export class AuthorService {
  constructor(
    @InjectRepository(Author)
    private readonly authorRepository: Repository<Author>,
  ) {}

  // ✅ Create new author
  async create(authorData: Partial<Author>): Promise<Author> {
    console.log(authorData,"check");
    const author = this.authorRepository.create(authorData);
    return this.authorRepository.save(author);
  }

  // ✅ Get all authors
  async findAll(): Promise<Author[]> {
    return this.authorRepository.find({
      relations: ['products'],
      order: { createdAt: 'DESC' },
    });
  }
async findAllOptions(): Promise<{ label: string; value: string }[]> {
  return this.authorRepository
    .createQueryBuilder('author')
    .select(['author.name AS label', 'author.id AS value'])
    .orderBy('author.createdAt', 'DESC')
    .getRawMany();
}


  // ✅ Get author by ID
  async findOne(id: string): Promise<Author> {
    const author = await this.authorRepository.findOne({
      where: { id },
      relations: ['products'],
    });
    if (!author) {
      throw new NotFoundException(`Author not found with id ${id}`);
    }
    return author;
  }

  // ✅ Update author
  async update(id: string, updateData: Partial<Author>): Promise<Author> {
    const author = await this.findOne(id);
    Object.assign(author, updateData);
    return this.authorRepository.save(author);
  }

  // ✅ Delete author
  async remove(id: string): Promise<void> {
    const author = await this.findOne(id);
    await this.authorRepository.remove(author);
  }
}
