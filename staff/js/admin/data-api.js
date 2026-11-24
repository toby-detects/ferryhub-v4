/* Admin data access layer: the ONLY place the Admin pages get booking records from.
   Records come from the FerryHub database through /api/staff?a=admin.bookings (admin login required).
   One record per booking (one registration number):
   { regNo, pax, port, departDate 'YYYY-MM-DD', departTime 'HH:MM', registeredAt ISO +08:00, totalFee (PHP), feeMissing,
     status 'Confirmed' | 'Verified' | 'Cancelled', passengers: [{ category, fare }] }
   Status: Confirmed = registered online, not yet verified at the ticketing station. Verified = ticket validated by staff. */
const BOOKING_STATUSES = ['Confirmed', 'Verified', 'Cancelled'];
const COUNTED_STATUSES = ['Confirmed', 'Verified']; // counted as bookings and passengers (Cancelled is excluded)
const REVENUE_STATUSES = ['Verified'];              // revenue counts only after payment is verified at the station

const AdminAPI = {
  async getBookings() { return (await Staff.api('admin.bookings')).bookings; },
  async getFares() { return (await Staff.api('admin.fares')).fares; }
};
