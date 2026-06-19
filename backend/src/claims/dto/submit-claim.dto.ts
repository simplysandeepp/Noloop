import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
  IsIn,
  IsDateString,
} from "class-validator";
import { Type } from "class-transformer";

export class LineItemDto {
  @IsString()
  @MinLength(2)
  desc!: string;

  @IsInt()
  @Min(0)
  amountPaise!: number;
}

export class SubmitClaimDto {
  // The insurer this claim is filed against (a tenant of type INSURER).
  @IsString()
  insurerTenantId!: string;

  @IsOptional()
  @IsIn(["CASHLESS", "REIMBURSEMENT"])
  type?: "CASHLESS" | "REIMBURSEMENT";

  @IsString()
  @MinLength(2)
  patientName!: string;

  @IsInt()
  @Min(0)
  patientAge!: number;

  @IsString()
  patientGender!: string;

  // Optional — links the claim to a known policyholder + their policy.
  @IsOptional()
  @IsString()
  memberId?: string;

  @IsString()
  @MinLength(2)
  diagnosis!: string;

  @IsString()
  @MinLength(2)
  procedure!: string;

  @IsDateString()
  admittedAt!: string;

  @IsDateString()
  dischargedAt!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => LineItemDto)
  lineItems!: LineItemDto[];

  // Optional stated total — if omitted, the line items are summed. A value that
  // disagrees with the line items is exactly what the engine's fraud check catches.
  @IsOptional()
  @IsInt()
  @Min(0)
  totalPaise?: number;

  // Optional — when the claim is generated from a discharge.
  @IsOptional()
  @IsString()
  admissionId?: string;
}
