-- Add payment method and invoice fields to orders table
ALTER TABLE public.orders 
ADD COLUMN payment_method TEXT NOT NULL DEFAULT 'card',
ADD COLUMN needs_invoice BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN invoice_company_name TEXT,
ADD COLUMN invoice_eik TEXT,
ADD COLUMN invoice_vat_number TEXT,
ADD COLUMN invoice_mol TEXT,
ADD COLUMN invoice_address TEXT;

-- Create index for payment method
CREATE INDEX IF NOT EXISTS idx_orders_payment_method ON public.orders(payment_method);

-- Allow updates for order status changes
DROP POLICY IF EXISTS "Allow public update" ON public.orders;
CREATE POLICY "Allow public update" ON public.orders 
  FOR UPDATE 
  USING (true)
  WITH CHECK (true);
