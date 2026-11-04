-- 038_olt_syslog_event.sql
-- Handler event syslog → inventori ONU + alert WhatsApp.
--
-- Menambah kolom jejak kejadian terakhir pada olt_onus, dipakai handler event
-- (syslog.events) untuk menandai kapan ONU terakhir terlihat up/down dan
-- kejadian apa penyebabnya (linkup/linkdown/dying gasp/deregister/register).
--
-- Sifat: idempoten (ADD COLUMN IF NOT EXISTS didukung MariaDB).

ALTER TABLE olt_onus
  ADD COLUMN IF NOT EXISTS last_event    VARCHAR(30) NULL AFTER phase_state,
  ADD COLUMN IF NOT EXISTS last_event_at DATETIME     NULL AFTER last_event;