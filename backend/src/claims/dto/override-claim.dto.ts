import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Min, MinLength } from "class-validator";

/** An insurer adjudicator's manual override of the AI decision. */
export class OverrideClaimDto {
  @IsIn(["APPROVE", "DENY", "QUERY"])
  verdict!: "APPROVE" | "DENY" | "QUERY";

  @IsOptional()
  @IsInt()
  @Min(0)
  approvedAmountPaise?: number;

  @IsString()
  @MinLength(3)
  note!: string;

  // If true, the claim is also marked SETTLED (paid out).
  @IsOptional()
  @IsBoolean()
  settle?: boolean;
}
