import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from "@nestjs/common";
import { AdmissionStatus, BedStatus, TenantType } from "@prisma/client";
import { PrismaService } from "../prisma/prisma.service";
import { AdmitDto } from "./dto/admit.dto";

@Injectable()
export class BedsService {
  constructor(private readonly prisma: PrismaService) {}

  private async hospital(tenantId: string | null) {
    if (!tenantId) throw new BadRequestException("No hospital on token");
    const t = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!t || t.type !== TenantType.HOSPITAL)
      throw new BadRequestException("Not a hospital account");
    return t;
  }

  /** Live capacity snapshot: per-ward counts + who is in each occupied bed. */
  async overview(tenantId: string | null) {
    const hospital = await this.hospital(tenantId);
    const wards = await this.prisma.ward.findMany({
      where: { hospitalTenantId: hospital.id },
      orderBy: { name: "asc" },
      include: { beds: true },
    });

    const active = await this.prisma.admission.findMany({
      where: { hospitalTenantId: hospital.id, status: AdmissionStatus.ADMITTED },
      include: { bed: { include: { ward: true } } },
      orderBy: { admittedAt: "desc" },
    });

    const totalBeds = wards.reduce((s, w) => s + w.beds.length, 0);
    const occupied = wards.reduce(
      (s, w) => s + w.beds.filter((b) => b.status === BedStatus.OCCUPIED).length,
      0,
    );
    const maintenance = wards.reduce(
      (s, w) =>
        s + w.beds.filter((b) => b.status === BedStatus.MAINTENANCE).length,
      0,
    );
    const available = totalBeds - occupied - maintenance;

    return {
      totalBeds,
      available,
      occupied,
      maintenance,
      occupancyRate: totalBeds ? Math.round((occupied / totalBeds) * 100) : 0,
      wards: wards.map((w) => {
        const occ = w.beds.filter((b) => b.status === BedStatus.OCCUPIED).length;
        return {
          id: w.id,
          name: w.name,
          totalBeds: w.beds.length,
          occupied: occ,
          available:
            w.beds.length -
            occ -
            w.beds.filter((b) => b.status === BedStatus.MAINTENANCE).length,
        };
      }),
      patients: active.map((a) => ({
        admissionId: a.id,
        patientName: a.patientName,
        patientAge: a.patientAge,
        patientGender: a.patientGender,
        diagnosis: a.diagnosis,
        procedure: a.procedure,
        ward: a.bed?.ward.name ?? "—",
        bed: a.bed?.label ?? "—",
        admittedAt: a.admittedAt,
      })),
    };
  }

  /** Admit a patient into the first available bed (optionally in a ward). */
  async admit(tenantId: string | null, dto: AdmitDto) {
    const hospital = await this.hospital(tenantId);
    const bed = await this.prisma.bed.findFirst({
      where: {
        hospitalTenantId: hospital.id,
        status: BedStatus.AVAILABLE,
        ...(dto.wardId ? { wardId: dto.wardId } : {}),
      },
      orderBy: { label: "asc" },
    });
    if (!bed)
      throw new BadRequestException("No available beds" + (dto.wardId ? " in that ward" : ""));

    const patient = dto.memberId
      ? await this.prisma.patient.findUnique({ where: { memberId: dto.memberId } })
      : null;

    const admission = await this.prisma.$transaction(async (tx) => {
      const a = await tx.admission.create({
        data: {
          hospitalTenantId: hospital.id,
          bedId: bed.id,
          patientId: patient?.id ?? null,
          patientName: dto.patientName,
          patientAge: dto.patientAge,
          patientGender: dto.patientGender,
          diagnosis: dto.diagnosis,
          procedure: dto.procedure,
          status: AdmissionStatus.ADMITTED,
        },
      });
      await tx.bed.update({
        where: { id: bed.id },
        data: { status: BedStatus.OCCUPIED },
      });
      return a;
    });
    return admission;
  }

  /** Discharge a patient and free their bed. */
  async discharge(tenantId: string | null, admissionId: string) {
    const hospital = await this.hospital(tenantId);
    const admission = await this.prisma.admission.findFirst({
      where: { id: admissionId, hospitalTenantId: hospital.id },
    });
    if (!admission) throw new NotFoundException("Admission not found");
    if (admission.status === AdmissionStatus.DISCHARGED) return admission;

    return this.prisma.$transaction(async (tx) => {
      const a = await tx.admission.update({
        where: { id: admission.id },
        data: { status: AdmissionStatus.DISCHARGED, dischargedAt: new Date() },
      });
      if (admission.bedId)
        await tx.bed.update({
          where: { id: admission.bedId },
          data: { status: BedStatus.AVAILABLE },
        });
      return a;
    });
  }
}
