import { IsString, MinLength } from "class-validator";

export class CreateEmployeeDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
