import { IsEmail, IsEnum, IsString, MinLength } from "class-validator";
import { TenantType } from "@prisma/client";

/** Self-serve org signup: creates the organization + its first admin. */
export class SignupDto {
  @IsString()
  @MinLength(2)
  orgName!: string;

  @IsEnum(TenantType)
  orgType!: TenantType; // HOSPITAL | INSURER

  @IsString()
  @MinLength(2)
  adminName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;
}
