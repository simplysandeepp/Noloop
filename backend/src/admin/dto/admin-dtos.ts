import {
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";

export class CreateOrgDto {
  @IsIn(["HOSPITAL", "INSURER"])
  type!: "HOSPITAL" | "INSURER";

  @IsString()
  @MinLength(2)
  name!: string;

  @IsString()
  @MinLength(2)
  adminName!: string;

  // Optional — omit to have the platform generate a temp password.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class AdminCreateUserDto {
  @IsString()
  tenantId!: string;

  @IsString()
  @MinLength(2)
  name!: string;

  // Optional explicit role; defaults to the org's staff role.
  @IsOptional()
  @IsIn([
    "HOSPITAL_ADMIN",
    "INSURER_ADMIN",
    "HOSPITAL_STAFF",
    "INSURER_ADJUDICATOR",
  ])
  role?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsIn([
    "HOSPITAL_ADMIN",
    "INSURER_ADMIN",
    "HOSPITAL_STAFF",
    "INSURER_ADJUDICATOR",
  ])
  role?: string;
}

export class ResetPasswordDto {
  // Optional — omit to auto-generate.
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;
}
