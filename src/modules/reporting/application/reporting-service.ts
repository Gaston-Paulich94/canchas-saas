import { withTenant } from "@/modules/shared/infrastructure/db/with-tenant";
import { assertRole } from "@/modules/shared/application/authz";
import { ROLES, type SessionContext } from "@/modules/auth/domain/roles";
import { arDayBounds } from "@/modules/reservations/domain/datetime";
import {
  reportRangeSchema,
  type ReportRange,
  type ReportingOverview,
} from "@/modules/reporting/domain/reporting";
import {
  getRevenueSummary,
  getCourtOccupancy,
  getPeakHours,
  getFrequentCustomers,
} from "@/modules/reporting/infrastructure/reporting.repository";

/**
 * Reporting del complejo.
 *
 * Los números del negocio (facturación, clientes) son sensibles: los ve el
 * dueño. El staff opera el día a día desde el panel, pero no accede a los
 * reportes históricos.
 */

const REPORT_ROLES = [ROLES.OWNER] as const;

export async function getReportingOverview(
  ctx: SessionContext,
  range: ReportRange,
): Promise<ReportingOverview> {
  assertRole(ctx, REPORT_ROLES);

  // Defensa en profundidad: aunque la página ya validó, el tope del período es
  // una garantía del caso de uso (una consulta sin tope es un DoS para todos
  // los complejos de la base compartida). Rango inválido => lanza, no consulta.
  const valid = reportRangeSchema.parse(range);

  // El rango es inclusivo en ambos extremos: `to` es el inicio del día
  // siguiente al `hasta` elegido.
  const from = arDayBounds(valid.desde).from;
  const to = arDayBounds(valid.hasta).to;

  return withTenant(ctx.tenantId, async (tx) => {
    const [revenue, ocupacion, picos, frecuentes] = await Promise.all([
      getRevenueSummary(tx, ctx.tenantId, from, to),
      getCourtOccupancy(tx, ctx.tenantId, valid.desde, valid.hasta, from, to),
      getPeakHours(tx, ctx.tenantId, from, to),
      getFrequentCustomers(tx, ctx.tenantId, from, to),
    ]);

    return { range: valid, revenue, ocupacion, picos, frecuentes };
  });
}
