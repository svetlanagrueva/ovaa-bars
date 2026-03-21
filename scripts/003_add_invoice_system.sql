-- Add invoice fields to orders table
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS invoice_number text UNIQUE,
  ADD COLUMN IF NOT EXISTS invoice_date timestamptz;

-- Singleton table for atomic sequential invoice numbering
CREATE TABLE IF NOT EXISTS public.invoice_counter (
  id integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  current_number bigint NOT NULL DEFAULT 0
);

INSERT INTO public.invoice_counter (id, current_number)
VALUES (1, 0)
ON CONFLICT (id) DO NOTHING;

-- Atomic increment function (gap-free, concurrent-safe)
CREATE OR REPLACE FUNCTION public.next_invoice_number()
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  next_num bigint;
BEGIN
  UPDATE public.invoice_counter
  SET current_number = current_number + 1
  WHERE id = 1
  RETURNING current_number INTO next_num;
  RETURN next_num;
END;
$$;

-- Index for invoice lookup
CREATE INDEX IF NOT EXISTS idx_orders_invoice_number ON public.orders (invoice_number)
  WHERE invoice_number IS NOT NULL;
