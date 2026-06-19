import { SetMetadata } from "@nestjs/common";
import { Role } from "@prisma/client";

export const ROLES_KEY = "roles";

/** Restrict a route to specific roles, e.g. @Roles(Role.PLATFORM_ADMIN). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
