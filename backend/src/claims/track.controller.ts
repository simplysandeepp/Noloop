import { Controller, Get, Param } from "@nestjs/common";
import { ClaimsService } from "./claims.service";

/** Public claim tracking — a patient can follow a claim by its number. */
@Controller("track")
export class TrackController {
  constructor(private readonly claims: ClaimsService) {}

  @Get(":claimNumber")
  track(@Param("claimNumber") claimNumber: string) {
    return this.claims.track(claimNumber);
  }
}
