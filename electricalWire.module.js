/*
electricalWire.module.js — ES-Modul-Wrapper für electricalWire

Einbindung via:
  import { ElectricalWire } from './electricalWire.module.js';
  // oder:
  import ElectricalWire from './electricalWire.module.js';

Für klassische <script>-Tags:
  <script src="electricalWire.js"></script>
  → window.ElectricalWire
*/

await import('./electricalWire.js');

export const ElectricalWire = window.ElectricalWire;
export default window.ElectricalWire;