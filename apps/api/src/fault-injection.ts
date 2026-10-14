import type { Patient, Slot } from "@carex/contracts";
import { SchedulingTimeoutError, SchedulingUnavailableError, type BookingRecord, type ReserveInput, type SchedulingSource } from "./scheduling.js";

export type Fault = "unavailable" | "timeout_before_commit" | "timeout_after_commit";

/**
 * TEST SUPPORT ONLY. Wraps the real scheduling engine and injects the failures a network integration would have, so the
 * booking service's pending/reconcile behaviour can be exercised against real storage. Not exported from the app entry points.
 */
export class FaultInjectingScheduling implements SchedulingSource {
  private faults: Fault[] = [];
  constructor(private inner: SchedulingSource) {}
  injectFault(f: Fault) { this.faults.push(f); }
  listSlots(q: { tenantId: string; clinicId: string; serviceId: string; providerId: string }): Promise<Slot[]> { return this.inner.listSlots(q); }
  async reserve(i: ReserveInput & { patient: Patient }): Promise<BookingRecord> {
    const fault = this.faults.shift();
    if (fault === "unavailable") throw new SchedulingUnavailableError("scheduling source unavailable");
    if (fault === "timeout_before_commit") throw new SchedulingTimeoutError("timed out before commit");
    const rec = await this.inner.reserve(i);
    if (fault === "timeout_after_commit") throw new SchedulingTimeoutError("timed out after commit");
    return rec;
  }
  lookupByKey(tenantId: string, key: string) { return this.inner.lookupByKey(tenantId, key); }
  getBooking(tenantId: string, bookingId: string) { return this.inner.getBooking(tenantId, bookingId); }
  cancel(tenantId: string, bookingId: string) { return this.inner.cancel(tenantId, bookingId); }
  reschedule(tenantId: string, bookingId: string, newSlotId: string) { return this.inner.reschedule(tenantId, bookingId, newSlotId); }
}
