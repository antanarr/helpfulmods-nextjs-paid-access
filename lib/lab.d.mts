export function assertLocal(request: Request): void;
export function beginCheckout(requestKey: string): { status: string; checkoutId: string; simulated: true };
export function setLabStatus(status: string): void;
export function labAccess(): { allowed: boolean; status: string; simulated: true };
