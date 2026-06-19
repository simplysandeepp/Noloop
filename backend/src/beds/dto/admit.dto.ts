import { IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

export class AdmitDto {
  @IsString()
  @MinLength(2)
  patientName!: string;

  @IsInt()
  @Min(0)
  patientAge!: number;

  @IsString()
  patientGender!: string;

  @IsString()
  @MinLength(2)
  diagnosis!: string;

  @IsString()
  @MinLength(2)
  procedure!: string;

  // Optional — admit into a specific ward; otherwise the first free bed.
  @IsOptional()
  @IsString()
  wardId?: string;

  // Optional — link to a known policyholder.
  @IsOptional()
  @IsString()
  memberId?: string;
}
