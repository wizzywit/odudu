export interface LogoutDelivery {
  id: string;
  session_id: string;
  endpoint: string;
  status: 'pending' | 'delivered' | 'failed';
  attempts: number;
  last_error: string | null;
  created_at: string;
  next_attempt_at: string;
  delivered_at: string | null;
}

export interface LogoutDeliveryList {
  items: LogoutDelivery[];
  next?: string | undefined;
}
