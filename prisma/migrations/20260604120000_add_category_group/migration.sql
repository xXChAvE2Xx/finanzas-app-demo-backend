-- Add "group" column to categories
ALTER TABLE "categories" ADD COLUMN "group" TEXT NOT NULL DEFAULT 'Otros';

-- ── Backfill existing system categories into logical groups ────────────────

-- INCOME
UPDATE "categories" SET "group" = 'Ingresos fijos'    WHERE "name" IN ('Salario / Nómina');
UPDATE "categories" SET "group" = 'Ingresos variables' WHERE "name" IN ('Freelance', 'Inversiones', 'Venta de artículos', 'Bono / Extra');
UPDATE "categories" SET "group" = 'Otros ingresos'     WHERE "name" IN ('Regalo / Transferencia', 'Otros ingresos');

-- EXPENSE → Hogar
UPDATE "categories" SET "group" = 'Hogar'        WHERE "name" IN ('Renta / Hipoteca', 'Servicios (luz/agua)', 'Internet / Teléfono', 'Mantenimiento hogar');
-- Alimentación
UPDATE "categories" SET "group" = 'Alimentación' WHERE "name" IN ('Alimentación', 'Restaurantes');
-- Transporte
UPDATE "categories" SET "group" = 'Transporte'   WHERE "name" IN ('Transporte', 'Gasolina');
-- Salud
UPDATE "categories" SET "group" = 'Salud'        WHERE "name" IN ('Salud / Médico', 'Farmacia', 'Gym / Deporte');
-- Ocio
UPDATE "categories" SET "group" = 'Ocio'         WHERE "name" IN ('Entretenimiento', 'Streaming', 'Viajes', 'Suscripciones');
-- Compras
UPDATE "categories" SET "group" = 'Compras'      WHERE "name" IN ('Ropa y accesorios', 'Regalos');
-- Educación
UPDATE "categories" SET "group" = 'Educación'    WHERE "name" IN ('Educación');
-- Finanzas
UPDATE "categories" SET "group" = 'Finanzas'     WHERE "name" IN ('Ahorro / Inversión', 'Deuda / Crédito', 'Seguros');
-- Mascotas
UPDATE "categories" SET "group" = 'Mascotas'     WHERE "name" IN ('Mascotas');
-- Otros gastos already default to 'Otros'
