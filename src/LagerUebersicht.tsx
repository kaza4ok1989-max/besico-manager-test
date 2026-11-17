import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, DragEvent } from 'react';
import { supabase } from './supabase';
import { RefreshCw, Search, MapPin, FileText, Plus, Trash2, GripVertical, Printer, ClipboardPlus } from 'lucide-react';

type Schein = { id: string; belegnummer: string | null; kennzeichen: string; lager: string; lagerplatz: string; daten: Record<string, unknown> | null; erstellt_am: string; besico_lager_id: string | null };
type WarehouseInfo = { id: string; standort_id: string; name: string };
type BranchRadsatz = { id: string; belegnummer: string | null; kennzeichen: string; lagerplatz: string; besico_lager_id: string | null; daten: Record<string, unknown> | null; erstellt_am: string };
type BereichTyp = 'Regal' | 'Reihe' | 'Bereich';
type LagerBereich = { id: string; lager_id: string; name: string; typ: BereichTyp };
type LagerPlatz = { id: string; bereich_id: string; ebene: string; platz_nummer: string };
type LagerUebersichtProps = { view: 'Radsätze' | 'Lagerplan'; standortId: string; standortName: string };
type Area = 'Zelt' | 'Lager';
const btn: CSSProperties = { border: '1px solid #cbd5e1', background: '#fff', borderRadius: 8, padding: '9px 12px', cursor: 'pointer', color: '#12365a', fontWeight: 600 };
const norm = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, '');
const searchNorm = (value: unknown): string => String(value ?? '').normalize('NFKD').toLocaleLowerCase('de-DE').replace(/ß/g, 'ss').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
const field = (r: Schein, key: string) => String(r.daten?.[key] ?? '').trim();
const qrUrl = (id: string) => `${window.location.origin}${import.meta.env.BASE_URL}?qr=${encodeURIComponent(id)}`;
const keyOf = (area: string, place: string) => `${norm(area)}::${norm(place)}`;
// Persist a readable warehouse-specific location, e.g. "Reihe 1 / Stapel 3 / Unten".
// The EXISTING database unique index on (besico_lager_id, normalized lagerplatz)
// protects this against simultaneous occupancy. Names are not editable in this UI.
const newPlaceLabel = (area: LagerBereich, place: LagerPlatz): string =>
  area.typ === 'Reihe'
    ? `${area.name} / Stapel ${Number(place.platz_nummer) || place.platz_nummer} / ${place.ebene}`
    : `${area.typ} ${area.name} / Platz ${place.platz_nummer} / ${place.ebene}`;

// Original locations imported from Excel are stored separately from current locations.
const oldArea = (r: Schein) => field(r, 'bereich_alt');
const oldPlace = (r: Schein) => field(r, 'lagerplatz_alt');
const oldLocation = (r: Schein) => oldPlace(r).toUpperCase();


/**
 * Warehouse setup for branches other than Glauchau.
 * Deliberately isolated from the existing Glauchau Lager/Zelt code.
 * Edits only the branch warehouse structure; existing wheel records are never deleted here.
 */
function StandortLagerEinrichtung({ standortId, standortName }: { standortId: string; standortName: string }) {
  const [branchWarehouses, setBranchWarehouses] = useState<WarehouseInfo[]>([]);
  const [selectedWarehouseId, setSelectedWarehouseId] = useState('');
  const [newWarehouseName, setNewWarehouseName] = useState('');
  // Read-only branch stock, including imported sets in Wareneingang (Excel).
  const [branchStock, setBranchStock] = useState<BranchRadsatz[]>([]);
  const [branchStockLoading, setBranchStockLoading] = useState(false);
  const [branchStockError, setBranchStockError] = useState('');
  const [branchStockRefresh, setBranchStockRefresh] = useState(0);
  const [branchStockQuery, setBranchStockQuery] = useState('');
  const [stockWorking, setStockWorking] = useState(false);
  const [stockMessage, setStockMessage] = useState('');
  const [stockError, setStockError] = useState('');
  const [draggedStockId, setDraggedStockId] = useState<string | null>(null);
  const [assignStockId, setAssignStockId] = useState('');
  const [assignPlaceId, setAssignPlaceId] = useState('');
  const [dropHoverPlaceId, setDropHoverPlaceId] = useState<string | null>(null);
  const [selectedPlanPlaceId, setSelectedPlanPlaceId] = useState('');
  const [branchPrintArea, setBranchPrintArea] = useState('all');
  const [branchPrintFree, setBranchPrintFree] = useState(true);
  const [toolsOpen, setToolsOpen] = useState(true);
  const [toolsWidth, setToolsWidth] = useState(340);
  const [resizingTools, setResizingTools] = useState(false);
  const [quickBranchOpen, setQuickBranchOpen] = useState(false);
  const [quickBranchPlate, setQuickBranchPlate] = useState('');
  const [quickBranchPlaceId, setQuickBranchPlaceId] = useState('');
  const [quickBranchNote, setQuickBranchNote] = useState('');
  const [quickBranchCreatedId, setQuickBranchCreatedId] = useState('');

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  // Separate database tables for the warehouse layout. No Glauchau legacy tables
  // or reifenlager_scheine records are modified by this setup interface.
  const [areas, setAreas] = useState<LagerBereich[]>([]);
  const [places, setPlaces] = useState<LagerPlatz[]>([]);
  const [selectedAreaId, setSelectedAreaId] = useState('');
  const [newAreaName, setNewAreaName] = useState('');
  const [newAreaType, setNewAreaType] = useState<BereichTyp>('Regal');
  const [rowStackCount, setRowStackCount] = useState('6');
  const [extraStackStart, setExtraStackStart] = useState('7');
  const [extraStackCount, setExtraStackCount] = useState('1');
  // Null means occupancy has NOT been verified; never show a potentially occupied slot as free.
  const [warehouseWheelCount, setWarehouseWheelCount] = useState<number | null>(null);
  const [levelName, setLevelName] = useState('Unten');
  const [firstNumber, setFirstNumber] = useState('1');
  const [numberOfPlaces, setNumberOfPlaces] = useState('3');
  const [structureLoading, setStructureLoading] = useState(false);
  const [structureSaving, setStructureSaving] = useState(false);
  const [structureError, setStructureError] = useState('');
  const [structureReadFailed, setStructureReadFailed] = useState(false);
  const [structureMessage, setStructureMessage] = useState('');
  const [structureReload, setStructureReload] = useState(0);
  const structureWarehouseRef = useRef('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setMessage('');
    setBranchWarehouses([]);
    setSelectedWarehouseId('');
    void (async () => {
      const { data, error: loadError } = await supabase.from('besico_lager')
        .select('id,standort_id,name')
        .eq('standort_id', standortId)
        .order('name');
      if (!active) return;
      if (loadError) {
        setError('Lager konnten nicht geladen werden: ' + loadError.message);
      } else {
        const list = (data ?? []) as WarehouseInfo[];
        setBranchWarehouses(list);
        setSelectedWarehouseId(previous => list.some(item => item.id === previous) ? previous : (list[0]?.id ?? ''));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [standortId]);

  const availableWarehouses = branchWarehouses.filter(item => item.standort_id === standortId);
  const selectedWarehouse = availableWarehouses.find(item => item.id === selectedWarehouseId);
  useEffect(() => {
    setAssignPlaceId(''); setDropHoverPlaceId(null); setSelectedPlanPlaceId(''); setBranchPrintArea('all');
    setQuickBranchPlaceId(''); setQuickBranchCreatedId('');
  }, [selectedWarehouseId]);
  useEffect(() => {
    if (!assignStockId) return;
    document.getElementById('filiale-platz-zuweisen')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [assignStockId]);


  // Never query across branches: retrieve receipts only by this city's warehouse IDs.
  // Loaded sets are displayed without changing the receipts or assigning slots.
  useEffect(() => {
    let active = true;
    const ids = branchWarehouses
      .filter(item => item.standort_id === standortId).map(item => item.id);
    setBranchStock([]);
    setBranchStockError('');
    if (!ids.length) {
      setBranchStockLoading(false);
      return () => { active = false; };
    }
    setBranchStockLoading(true);
    void (async () => {
      try {
        const all: BranchRadsatz[] = [];
        // Page Supabase results; the API's default maximum is often 1,000.
        for (let batchIndex = 0; batchIndex < ids.length; batchIndex += 25) {
          const warehouseIds = ids.slice(batchIndex, batchIndex + 25);
          for (let start = 0; ; start += 1000) {
            const { data, error: readError } = await supabase.from('reifenlager_scheine')
              .select('id,belegnummer,kennzeichen,lagerplatz,besico_lager_id,daten,erstellt_am')
              .in('besico_lager_id', warehouseIds)
              .order('erstellt_am', { ascending: false })
              .range(start, start + 999);
            if (readError) throw readError;
            const page = (data ?? []) as BranchRadsatz[];
            all.push(...page);
            if (page.length < 1000) break;
          }
        }
        if (active) setBranchStock(all);
      } catch (cause) {
        if (active) setBranchStockError('Radsätze konnten nicht geladen werden: ' +
          (cause instanceof Error ? cause.message : String(cause)));
      } finally {
        if (active) setBranchStockLoading(false);
      }
    })();
    return () => { active = false; };
  }, [branchWarehouses, standortId, branchStockRefresh]);

  const incomingWarehouse = availableWarehouses.find(item => item.name.trim().toLocaleLowerCase('de-DE') === 'wareneingang (excel)');
  const visibleBranchStock = branchStock.filter(item =>
    availableWarehouses.some(warehouse => warehouse.id === item.besico_lager_id));
  const incomingCount = incomingWarehouse
    ? visibleBranchStock.filter(item => item.besico_lager_id === incomingWarehouse.id).length : 0;
  const selectedWarehouseCount = visibleBranchStock.filter(item => item.besico_lager_id === selectedWarehouseId).length;
  const hideEmptyIncoming = !!incomingWarehouse && !branchStockLoading && !branchStockError &&
    incomingCount === 0 && availableWarehouses.some(item => item.id !== incomingWarehouse.id);
  useEffect(() => {
    if (!hideEmptyIncoming || selectedWarehouseId !== incomingWarehouse?.id) return;
    const nextWarehouse = availableWarehouses.find(item => item.id !== incomingWarehouse?.id);
    if (nextWarehouse) setSelectedWarehouseId(nextWarehouse.id);
  }, [hideEmptyIncoming, selectedWarehouseId, incomingWarehouse?.id, availableWarehouses]);
  const stockTerm = searchNorm(branchStockQuery);
  const filteredBranchStock = visibleBranchStock.filter(item => {
    if (!stockTerm) return true;
    const warehouseName = availableWarehouses.find(warehouse => warehouse.id === item.besico_lager_id)?.name ?? '';
    const values = [item.kennzeichen, item.belegnummer, item.lagerplatz, warehouseName, standortName,
      ...Object.values(item.daten ?? {}).filter(value => typeof value === 'string' || typeof value === 'number')];
    const combined = searchNorm(values.join(' '));
    return combined.includes(stockTerm) || branchStockQuery.trim().split(/\s+/).every(word =>
      combined.includes(searchNorm(word)));
  }).sort((a, b) => {
    // Show unassigned incoming stock first; keep the remainder in date order.
    const aIncoming = a.besico_lager_id === incomingWarehouse?.id ? 0 : 1;
    const bIncoming = b.besico_lager_id === incomingWarehouse?.id ? 0 : 1;
    return aIncoming - bIncoming || b.erstellt_am.localeCompare(a.erstellt_am);
  });

  useEffect(() => {
    let active = true;
    setAreas([]);
    setPlaces([]);
    // Keep feedback from a successful/failed delete when refreshing this same
    // warehouse. Clear it only when the employee switches warehouses.
    const warehouseKey = selectedWarehouse?.id ?? '';
    if (structureWarehouseRef.current !== warehouseKey) {
      setStructureMessage('');
      setStructureError('');
      structureWarehouseRef.current = warehouseKey;
    }
    setStructureReadFailed(false);
    setWarehouseWheelCount(null);
    if (!selectedWarehouse) {
      setStructureLoading(false);
      return () => { active = false; };
    }
    setStructureLoading(true);
    const warehouseId = selectedWarehouse.id;
    void (async () => {
      try {
        const allAreas: LagerBereich[] = [];
        // Supabase can cap a response at 1000 rows. Load pages explicitly.
        for (let from = 0; ; from += 1000) {
          const { data, error: readError } = await supabase.from('besico_lager_bereiche')
            .select('id,lager_id,name,typ').eq('lager_id', warehouseId)
            .order('name').order('id').range(from, from + 999);
          if (readError) throw readError;
          const batch = (data ?? []) as LagerBereich[];
          allAreas.push(...batch);
          if (batch.length < 1000) break;
        }
        const allPlaces: LagerPlatz[] = [];
        // Query only area IDs from this warehouse. Keep IN requests compact.
        for (let index = 0; index < allAreas.length; index += 25) {
          const ids = allAreas.slice(index, index + 25).map(area => area.id);
          for (let from = 0; ; from += 1000) {
            const { data, error: readError } = await supabase.from('besico_lagerplaetze')
              .select('id,bereich_id,ebene,platz_nummer').in('bereich_id', ids)
              .order('id').range(from, from + 999);
            if (readError) throw readError;
            const batch = (data ?? []) as LagerPlatz[];
            allPlaces.push(...batch);
            if (batch.length < 1000) break;
          }
        }
        // A wheel belongs to the warehouse, not yet to a new-style slot. Do not
        // infer that a slot is free if that warehouse already contains wheels.
        const wheelResult = await supabase.from('reifenlager_scheine')
          .select('id', { count: 'exact', head: true })
          .eq('besico_lager_id', warehouseId);
        if (!active) return;
        setWarehouseWheelCount(wheelResult.error ? null : wheelResult.count);
        setAreas(allAreas);
        setPlaces(allPlaces);
        setSelectedAreaId(previous => allAreas.some(area => area.id === previous) ? previous : (allAreas[0]?.id ?? ''));
      } catch (cause) {
        if (!active) return;
        setStructureReadFailed(true);
        setStructureError('Lagerstruktur konnte nicht geladen werden: ' + (cause instanceof Error ? cause.message : String(cause)));
      } finally {
        if (active) setStructureLoading(false);
      }
    })();
    return () => { active = false; };
  }, [selectedWarehouse?.id, structureReload]);

  async function createWarehouse() {
    const name = newWarehouseName.trim().replace(/\s+/g, ' ');
    if (loading || saving || !standortId) return;
    if (!name || name.length > 60) {
      setError('Lagername: bitte 1 bis 60 Zeichen eingeben.');
      return;
    }
    if (availableWarehouses.some(item => item.name.localeCompare(name, 'de', { sensitivity: 'base' }) === 0)) {
      setError('Ein Lager mit diesem Namen existiert bereits in dieser Filiale.');
      return;
    }
    setSaving(true);
    setError('');
    setMessage('');
    try {
      const { data, error: insertError } = await supabase.from('besico_lager')
        .insert({ standort_id: standortId, name })
        .select('id,standort_id,name')
        .single();
      if (insertError || !data) throw insertError ?? new Error('Lager konnte nicht erstellt werden.');
      const created = data as WarehouseInfo;
      setNewWarehouseName('');
      setMessage(`Lager „${created.name}“ wurde für ${standortName} angelegt.`);
      // Make the new warehouse visible immediately and keep it selected.
      setBranchWarehouses(previous => [...previous.filter(item => item.id !== created.id), created]);
      setSelectedWarehouseId(created.id);
    } catch (cause) {
      setError('Lager anlegen: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setSaving(false);
    }
  }

  const selectedArea = areas.find(area => area.id === selectedAreaId && area.lager_id === selectedWarehouse?.id);
  const selectedAreaPlaces = selectedArea ? places.filter(place => place.bereich_id === selectedArea.id) : [];
  const layoutBusy = loading || saving || structureLoading || structureSaving || structureReadFailed || stockWorking;

  const physicalWarehouseSelected = !!selectedWarehouse &&
    selectedWarehouse.name.trim().toLocaleLowerCase('de-DE') !== 'wareneingang (excel)';
  // Combine only place IDs belonging to the selected warehouse. It is never safe to
  // build locations from the global legacy shelf tables for another branch.
  const newWarehouseSlots = places.flatMap(place => {
    const area = areas.find(entry => entry.id === place.bereich_id && entry.lager_id === selectedWarehouseId);
    return area ? [{ area, place, label: newPlaceLabel(area, place) }] : [];
  });
  const warehouseStock = visibleBranchStock.filter(item => item.besico_lager_id === selectedWarehouseId);
  const stockForPlace = (label: string) => warehouseStock.filter(item => norm(item.lagerplatz) === norm(label));
  // Fail closed while any read is incomplete; never offer a possibly occupied slot.
  const stockIsVerified = !!selectedWarehouse && !loading && !structureLoading &&
    !branchStockLoading && !branchStockError && !structureReadFailed &&
    warehouseWheelCount !== null && warehouseWheelCount === warehouseStock.length;
  const unmatchedPlaces = warehouseStock.filter(item => !!item.lagerplatz?.trim() &&
    !newWarehouseSlots.some(slot => norm(slot.label) === norm(item.lagerplatz)));
  const slotNamesAreUnique = new Set(newWarehouseSlots.map(slot => norm(slot.label))).size === newWarehouseSlots.length;
  const planIsVerified = stockIsVerified && unmatchedPlaces.length === 0 && slotNamesAreUnique;
  const freeNewSlots = planIsVerified && physicalWarehouseSelected
    ? newWarehouseSlots.filter(slot => stockForPlace(slot.label).length === 0) : [];
  const assignStock = visibleBranchStock.find(item => item.id === assignStockId);

  async function quickAddBranch() {
    const plate = quickBranchPlate.trim().replace(/\s+/g, ' ').toUpperCase();
    if (stockWorking || layoutBusy) return;
    if (!plate || plate.length > 32) { setStockError('Kennzeichen: bitte 1 bis 32 Zeichen eingeben.'); return; }
    if (!selectedWarehouse || !physicalWarehouseSelected || !planIsVerified) {
      setStockError('Bitte zuerst ein echtes Lager mit geprüften freien Lagerplätzen auswählen.'); return;
    }
    const slot = freeNewSlots.find(item => item.place.id === quickBranchPlaceId);
    if (!slot) { setStockError('Bitte einen freien Lagerplatz auswählen.'); return; }
    if (!window.confirm(`Schnellaufnahme anlegen?\n\nKennzeichen: ${plate}\nFiliale: ${standortName}\nLager: ${selectedWarehouse.name}\nLagerplatz: ${slot.label}`)) return;
    setStockWorking(true); setStockError(''); setStockMessage(''); setQuickBranchCreatedId('');
    try {
      const [warehouseCheck, areaCheck, placeCheck, existingAtPlace, duplicatePlate] = await Promise.all([
        supabase.from('besico_lager').select('id').eq('id', selectedWarehouse.id).eq('standort_id', standortId).single(),
        supabase.from('besico_lager_bereiche').select('id').eq('id', slot.area.id).eq('lager_id', selectedWarehouse.id).single(),
        supabase.from('besico_lagerplaetze').select('id').eq('id', slot.place.id).eq('bereich_id', slot.area.id).single(),
        supabase.from('reifenlager_scheine').select('id,lagerplatz').eq('besico_lager_id', selectedWarehouse.id),
        supabase.from('reifenlager_scheine').select('id,kennzeichen').in('besico_lager_id', availableWarehouses.map(item => item.id)),
      ]);
      if (warehouseCheck.error || !warehouseCheck.data || areaCheck.error || !areaCheck.data || placeCheck.error || !placeCheck.data) {
        throw new Error('Lagerstruktur wurde geändert. Bitte aktualisieren.');
      }
      if (existingAtPlace.error || duplicatePlate.error) throw existingAtPlace.error ?? duplicatePlate.error;
      if ((existingAtPlace.data ?? []).some(item => norm(item.lagerplatz) === norm(slot.label))) {
        throw new Error('Der Lagerplatz ist inzwischen belegt. Bitte aktualisieren.');
      }
      const dupes = (duplicatePlate.data ?? []).filter(item => searchNorm(item.kennzeichen) === searchNorm(plate));
      if (dupes.length && !window.confirm(`Kennzeichen ${plate} ist bereits ${dupes.length}× in ${standortName} vorhanden. Trotzdem zusätzlich anlegen?`)) return;
      const receipt = `SCHNELL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const { data: created, error: saveError } = await supabase.from('reifenlager_scheine').insert({
        belegnummer: receipt, kennzeichen: plate, lager: '', lagerplatz: slot.label,
        besico_lager_id: selectedWarehouse.id,
        daten: { belegnummer: receipt, kennzeichen: plate, schnellaufnahme: true,
          status: 'Unvollständig', bemerkung: quickBranchNote.trim(),
          import_standort_name: standortName, import_lager_name: selectedWarehouse.name,
          datum: new Date().toISOString().slice(0, 10) },
      }).select('id').single();
      if (saveError || !created) throw saveError ?? new Error('Speichern fehlgeschlagen.');
      setQuickBranchCreatedId(created.id);
      setQuickBranchPlate(''); setQuickBranchNote(''); setQuickBranchPlaceId('');
      setStockMessage(`${plate} → ${selectedWarehouse.name} / ${slot.label} als Schnellaufnahme gespeichert.`);
      setBranchStockRefresh(value => value + 1);
      setStructureReload(value => value + 1);
    } catch (cause) {
      setStockError('Schnellaufnahme: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { setStockWorking(false); }
  }

  async function moveBranchStock(scheinId: string, placeId: string) {
    if (stockWorking || layoutBusy || !planIsVerified || !physicalWarehouseSelected || !selectedWarehouse) return;
    const set = visibleBranchStock.find(item => item.id === scheinId);
    const slot = newWarehouseSlots.find(item => item.place.id === placeId);
    if (!set || !slot) { setStockError('Radsatz oder Lagerplatz nicht gefunden. Bitte aktualisieren.'); return; }
    if (!set.besico_lager_id || !availableWarehouses.some(item => item.id === set.besico_lager_id)) {
      setStockError('Dieser Radsatz gehört nicht zur ausgewählten Filiale. Verschieben gesperrt.'); return;
    }
    if (stockForPlace(slot.label).some(item => item.id !== set.id)) {
      setStockError('Der Zielplatz ist bereits belegt.'); return;
    }
    if (set.besico_lager_id === selectedWarehouse.id && norm(set.lagerplatz) === norm(slot.label)) return;
    if (!window.confirm(`${set.kennzeichen || set.belegnummer || 'Radsatz'} verschieben?\n\nFiliale: ${standortName}\nLager: ${selectedWarehouse.name}\nLagerplatz: ${slot.label}\n\nEinlagerungsschein, QR und Historie bleiben erhalten.`)) return;
    setStockWorking(true); setStockError(''); setStockMessage('');
    try {
      // Reconfirm that the destination warehouse, area and place still belong to
      // this city/warehouse; no schema assumptions or cross-city moves.
      const [targetResult, areaResult, placeResult, sourceResult] = await Promise.all([
        supabase.from('besico_lager').select('id').eq('id', selectedWarehouse.id).eq('standort_id', standortId).single(),
        supabase.from('besico_lager_bereiche').select('id').eq('id', slot.area.id).eq('lager_id', selectedWarehouse.id).single(),
        supabase.from('besico_lagerplaetze').select('id').eq('id', slot.place.id).eq('bereich_id', slot.area.id).single(),
        supabase.from('reifenlager_scheine').select('id,besico_lager_id,lagerplatz').eq('id', set.id).single(),
      ]);
      if (targetResult.error || !targetResult.data || areaResult.error || !areaResult.data ||
          placeResult.error || !placeResult.data || sourceResult.error || !sourceResult.data) {
        throw new Error('Lager, Lagerplatz oder Radsatz konnte nicht sicher geprüft werden.');
      }
      const current = sourceResult.data as { id: string; besico_lager_id: string | null; lagerplatz: string };
      if (current.besico_lager_id !== set.besico_lager_id || norm(current.lagerplatz) !== norm(set.lagerplatz)) {
        throw new Error('Der Radsatz wurde inzwischen verändert. Bitte Bestand aktualisieren.');
      }
      // The unique index besico_lager_id+normalized lagerplatz is the final
      // collision guard, including simultaneous updates from two browsers.
      const { data: updated, error: writeError } = await supabase.from('reifenlager_scheine')
        .update({ besico_lager_id: selectedWarehouse.id, lager: '', lagerplatz: slot.label })
        .eq('id', set.id).eq('besico_lager_id', set.besico_lager_id)
        .eq('lagerplatz', current.lagerplatz).select('id');
      if (writeError) throw new Error(writeError.message);
      if (updated?.length !== 1) throw new Error('Keine Änderung bestätigt. Bestand bitte erneut laden.');
      setStockMessage(`${set.kennzeichen || 'Radsatz'} → ${selectedWarehouse.name} / ${slot.label} gespeichert.`);
      setAssignStockId(''); setAssignPlaceId(''); setSelectedPlanPlaceId('');
      setBranchStockRefresh(n => n + 1);
      setStructureReload(n => n + 1);
    } catch (cause) {
      setStockError('Platz zuweisen: ' + (cause instanceof Error ? cause.message : String(cause)));
      setBranchStockRefresh(n => n + 1);
      setStructureReload(n => n + 1);
    } finally { setStockWorking(false); setDraggedStockId(null); setDropHoverPlaceId(null); }
  }

  async function releaseBranchStock(scheinId: string) {
    if (stockWorking || layoutBusy) return;
    const set = visibleBranchStock.find(item => item.id === scheinId);
    if (!set || !set.besico_lager_id || !availableWarehouses.some(item => item.id === set.besico_lager_id)) return;
    if (!set.lagerplatz.trim()) return;
    if (!window.confirm(`${set.kennzeichen || set.belegnummer || 'Radsatz'}: Lagerplatz freigeben?\nDer Radsatz bleibt im selben Lager; Schein und QR bleiben bestehen.`)) return;
    setStockWorking(true); setStockError(''); setStockMessage('');
    try {
      const { data, error: writeError } = await supabase.from('reifenlager_scheine')
        .update({ lagerplatz: '' }).eq('id', set.id)
        .eq('besico_lager_id', set.besico_lager_id)
        .eq('lagerplatz', set.lagerplatz).select('id');
      if (writeError) throw new Error(writeError.message);
      if (data?.length !== 1) throw new Error('Freigabe nicht bestätigt. Bitte aktualisieren.');
      setStockMessage(`${set.kennzeichen || 'Radsatz'}: Lagerplatz freigegeben (Lager bleibt erhalten).`);
      setBranchStockRefresh(n => n + 1); setStructureReload(n => n + 1);
    } catch (cause) {
      setStockError('Platz freigeben: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally { setStockWorking(false); }
  }

  function onBranchDragStart(event: DragEvent<HTMLElement>, id: string) {
    if (!planIsVerified || stockWorking || !physicalWarehouseSelected) { event.preventDefault(); return; }
    event.dataTransfer.setData('text/plain', id);
    event.dataTransfer.effectAllowed = 'move';
    setDraggedStockId(id);
  }
  function onBranchDragOver(event: DragEvent<HTMLDivElement>, placeId: string) {
    if (stockWorking || layoutBusy || !planIsVerified || !draggedStockId ||
        !freeNewSlots.some(item => item.place.id === placeId)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropHoverPlaceId(placeId);
  }
  function onBranchDrop(event: DragEvent<HTMLDivElement>, placeId: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || draggedStockId;
    setDropHoverPlaceId(null); setDraggedStockId(null);
    if (id && freeNewSlots.some(item => item.place.id === placeId)) void moveBranchStock(id, placeId);
  }


  async function createArea() {
    if (layoutBusy || !selectedWarehouse) return;
    const name = newAreaName.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 60) {
      setStructureError('Name: bitte 1 bis 60 Zeichen eingeben.');
      return;
    }
    if (areas.some(area => area.name.localeCompare(name, 'de', { sensitivity: 'base' }) === 0)) {
      setStructureError('Dieser Name wird in diesem Lager bereits verwendet.');
      return;
    }
    const stacks = Number(rowStackCount);
    if (newAreaType === 'Reihe' && (!Number.isSafeInteger(stacks) || stacks < 1 || stacks > 100)) {
      setStructureError('Bitte für eine Reihe 1 bis 100 Stapel auswählen.');
      return;
    }
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    let created: LagerBereich | null = null;
    try {
      const { data, error: insertError } = await supabase.from('besico_lager_bereiche')
        .insert({ lager_id: selectedWarehouse.id, name, typ: newAreaType })
        .select('id,lager_id,name,typ').single();
      if (insertError || !data) throw insertError ?? new Error('Bereich konnte nicht angelegt werden.');
      created = data as LagerBereich;
      setAreas(previous => [...previous, created!]);
      setSelectedAreaId(created.id);
      setNewAreaName('');

      if (created.typ === 'Reihe') {
        // As in the old Glauchau layout: Stapel 1..N, each with Oben/Unten.
        // Stored in the VERIFIED new tables only, scoped to this area's UUID.
        const rowPlaces = Array.from({ length: stacks }, (_, i) =>
          ['Oben', 'Unten'].map(ebene => ({
            bereich_id: created!.id,
            ebene,
            platz_nummer: String(i + 1).padStart(2, '0'),
          }))
        ).flat();
        const { data: inserted, error: placeError } = await supabase.from('besico_lagerplaetze')
          .insert(rowPlaces).select('id,bereich_id,ebene,platz_nummer');
        if (placeError || !inserted || inserted.length !== rowPlaces.length) {
          // A failed slot insert does not undo creation of the empty row. Say so.
          throw new Error(`Reihe „${created.name}“ wurde angelegt, aber die Plätze konnten nicht vollständig erstellt werden. Bitte „Aktualisieren“ und die Reihe prüfen. ${placeError?.message ?? ''}`);
        }
        setPlaces(previous => [...previous, ...(inserted as LagerPlatz[])]);
        setExtraStackStart(String(stacks + 1));
        setStructureMessage(`Reihe „${created.name}“ mit ${stacks} Stapeln und je zwei Ebenen (Oben / Unten) angelegt.`);
      } else {
        setStructureMessage(`${created.typ} „${created.name}“ im Lager „${selectedWarehouse.name}“ angelegt. Jetzt Ebenen und Plätze hinzufügen.`);
      }
    } catch (cause) {
      setStructureError('Regal / Reihe anlegen: ' + (cause instanceof Error ? cause.message : String(cause)));
      // Reload to reconcile any partial outcome, rather than claiming rollback.
      setStructureReload(previous => previous + 1);
    } finally {
      setStructureSaving(false);
    }
  }

  async function deleteArea(area: LagerBereich) {
    if (layoutBusy || !selectedWarehouse || area.lager_id !== selectedWarehouse.id) return;
    // Fail closed: don't delete any structural slots when occupancy is unknown.
    if (warehouseWheelCount !== 0) {
      setStructureError('Löschen ist nur erlaubt, wenn dieses Lager sicher keine Radsätze enthält. Bitte Bestand prüfen.');
      return;
    }
    const count = places.filter(place => place.bereich_id === area.id).length;
    if (!window.confirm(`${area.typ} „${area.name}“ mit ${count} Lagerplätzen wirklich löschen?\n\nNur die Lagerstruktur dieses Lagers wird gelöscht. Dieser Vorgang kann nicht rückgängig gemacht werden.`)) return;
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    try {
      // Re-check real database state immediately before the destructive action.
      // No old Glauchau tables, wheel records, QR codes or receipts are touched.
      const { data: current, error: areaError } = await supabase.from('besico_lager_bereiche')
        .select('id,lager_id').eq('id', area.id).eq('lager_id', selectedWarehouse.id).single();
      if (areaError || !current) throw areaError ?? new Error('Reihe nicht mehr vorhanden.');
      const { count: wheelCount, error: wheelError } = await supabase.from('reifenlager_scheine')
        .select('id', { count: 'exact', head: true }).eq('besico_lager_id', selectedWarehouse.id);
      if (wheelError || wheelCount === null || wheelCount !== 0) {
        throw new Error('Die Belegung konnte nicht sicher als leer bestätigt werden. Löschen abgebrochen.');
      }
      // Two scoped deletes are necessary because no safe server-side RPC has
      // been verified. If the second fails, refresh and explicitly report it.
      const { error: placeError } = await supabase.from('besico_lagerplaetze')
        .delete().eq('bereich_id', area.id);
      if (placeError) throw new Error('Plätze konnten nicht gelöscht werden: ' + placeError.message);
      const { data: deleted, error: deleteError } = await supabase.from('besico_lager_bereiche')
        .delete().eq('id', area.id).eq('lager_id', selectedWarehouse.id).select('id');
      if (deleteError || !deleted?.length) {
        throw new Error('Die Reihe konnte nicht gelöscht werden. Bitte nach dem Aktualisieren prüfen. ' + (deleteError?.message ?? 'Keine Zeile bestätigt.'));
      }
      setStructureMessage(`${area.typ} „${area.name}“ und ${count} Lagerplätze gelöscht.`);
      if (selectedAreaId === area.id) setSelectedAreaId('');
    } catch (cause) {
      setStructureError('Löschen: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      // Always reload, including on partial failure of the two DELETE steps.
      setStructureReload(previous => previous + 1);
      setStructureSaving(false);
    }
  }

  // Structural deletion is deliberately forbidden until the entire selected
  // warehouse has been confirmed empty again, immediately before deletion.
  // No reifenlager_scheine record is ever deleted by these controls.
  async function verifyEmptyWarehouse(warehouseId: string) {
    const { count, error: wheelError } = await supabase.from('reifenlager_scheine')
      .select('id', { count: 'exact', head: true }).eq('besico_lager_id', warehouseId);
    if (wheelError || count !== 0) {
      throw new Error('Das Lager ist nicht sicher leer. Löschen wurde zum Schutz der Radsätze abgebrochen.');
    }
  }

  async function deletePlace(place: LagerPlatz) {
    if (layoutBusy || !selectedWarehouse || warehouseWheelCount !== 0) return;
    const area = areas.find(item => item.id === place.bereich_id && item.lager_id === selectedWarehouse.id);
    if (!area || !places.some(item => item.id === place.id)) return;
    if (!window.confirm(`Lagerplatz „${area.name} / ${place.ebene} / ${place.platz_nummer}“ wirklich löschen?\n\nDer Einlagerungsschein wird dabei nicht gelöscht.`)) return;
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    try {
      const { data: current, error: areaError } = await supabase.from('besico_lager_bereiche')
        .select('id').eq('id', area.id).eq('lager_id', selectedWarehouse.id).single();
      if (areaError || !current) throw areaError ?? new Error('Regal / Reihe gehört nicht zu diesem Lager.');
      await verifyEmptyWarehouse(selectedWarehouse.id);
      const { data, error: deleteError } = await supabase.from('besico_lagerplaetze')
        .delete().eq('id', place.id).eq('bereich_id', area.id).select('id');
      if (deleteError || data?.length !== 1) {
        throw deleteError ?? new Error('Lagerplatz konnte nicht bestätigt gelöscht werden.');
      }
      setStructureMessage(`Lagerplatz ${area.name} / ${place.ebene} / ${place.platz_nummer} gelöscht.`);
    } catch (cause) {
      setStructureError('Lagerplatz löschen: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setStructureReload(value => value + 1);
      setStructureSaving(false);
    }
  }

  async function deleteStack(area: LagerBereich, stack: string) {
    if (layoutBusy || !selectedWarehouse || warehouseWheelCount !== 0 || area.typ !== 'Reihe' || area.lager_id !== selectedWarehouse.id) return;
    const stackPlaces = places.filter(place => place.bereich_id === area.id && place.platz_nummer === stack);
    if (!stackPlaces.length) return;
    if (!window.confirm(`Stapel ${Number(stack) || stack} in „${area.name}“ mit ${stackPlaces.length} Lagerplätzen löschen?`)) return;
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    try {
      const { data: current, error: areaError } = await supabase.from('besico_lager_bereiche')
        .select('id').eq('id', area.id).eq('lager_id', selectedWarehouse.id).single();
      if (areaError || !current) throw areaError ?? new Error('Reihe gehört nicht zu diesem Lager.');
      await verifyEmptyWarehouse(selectedWarehouse.id);
      const ids = stackPlaces.map(place => place.id);
      const { data, error: deleteError } = await supabase.from('besico_lagerplaetze')
        .delete().eq('bereich_id', area.id).in('id', ids).select('id');
      if (deleteError || data?.length !== ids.length) {
        throw deleteError ?? new Error('Nicht alle Lagerplätze wurden gelöscht. Bitte aktualisieren.');
      }
      setStructureMessage(`Stapel ${Number(stack) || stack} aus Reihe „${area.name}“ gelöscht.`);
    } catch (cause) {
      setStructureError('Stapel löschen: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setStructureReload(value => value + 1);
      setStructureSaving(false);
    }
  }

  async function addStacks() {
    if (layoutBusy || !selectedWarehouse || !selectedArea || selectedArea.typ !== 'Reihe') return;
    const first = Number(extraStackStart);
    const count = Number(extraStackCount);
    if (!Number.isSafeInteger(first) || first < 1 || first > 99999 ||
        !Number.isSafeInteger(count) || count < 1 || count > 100 || first + count - 1 > 99999) {
      setStructureError('Stapel: gültige Startnummer und Anzahl (1–100) eingeben.');
      return;
    }
    const requested = Array.from({ length: count }, (_, index) => String(first + index).padStart(2, '0'));
    // Prevent adding a new stack on top of an existing level (including a
    // partially created stack), rather than inadvertently changing its layout.
    if (requested.some(stack => places.some(place => place.bereich_id === selectedArea.id && place.platz_nummer === stack))) {
      setStructureError('Mindestens ein Stapel mit dieser Nummer existiert bereits. Bitte andere Nummer wählen.');
      return;
    }
    const payload = requested.flatMap(stack => ['Oben', 'Unten'].map(ebene => ({
      bereich_id: selectedArea.id, ebene, platz_nummer: stack,
    })));
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    try {
      const { data, error: insertError } = await supabase.from('besico_lagerplaetze')
        .insert(payload).select('id,bereich_id,ebene,platz_nummer');
      if (insertError || data?.length !== payload.length) {
        throw insertError ?? new Error('Nicht alle Stapel wurden gespeichert. Bitte aktualisieren.');
      }
      setPlaces(previous => [...previous, ...(data as LagerPlatz[])]);
      setExtraStackStart(String(first + count));
      setStructureMessage(`${count} Stapel mit Oben / Unten in Reihe „${selectedArea.name}“ hinzugefügt.`);
    } catch (cause) {
      setStructureError('Stapel hinzufügen: ' + (cause instanceof Error ? cause.message : String(cause)));
      setStructureReload(value => value + 1);
    } finally {
      setStructureSaving(false);
    }
  }

  async function createPlaces() {
    if (layoutBusy || !selectedWarehouse || !selectedArea) return;
    const ebene = levelName.trim().replace(/\s+/g, ' ');
    const first = Number(firstNumber);
    const count = Number(numberOfPlaces);
    if (!ebene || ebene.length > 60) {
      setStructureError('Ebene: bitte 1 bis 60 Zeichen eingeben.');
      return;
    }
    if (!Number.isSafeInteger(first) || first < 1 || first > 99999 ||
        !Number.isSafeInteger(count) || count < 1 || count > 100 || first + count - 1 > 99999) {
      setStructureError('Bitte eine gültige Startnummer (1–99999) und 1 bis 100 Plätze pro Vorgang eingeben.');
      return;
    }
    const newPlaces = Array.from({ length: count }, (_, index) => ({
      bereich_id: selectedArea.id,
      ebene,
      platz_nummer: String(first + index).padStart(2, '0'),
    }));
    if (newPlaces.some(next => selectedAreaPlaces.some(existing =>
      existing.ebene.localeCompare(next.ebene, 'de', { sensitivity: 'base' }) === 0 &&
      existing.platz_nummer === next.platz_nummer
    ))) {
      setStructureError('Mindestens ein Platz mit dieser Ebene und Nummer existiert bereits. Bitte andere Startnummer wählen.');
      return;
    }
    setStructureSaving(true);
    setStructureError('');
    setStructureMessage('');
    try {
      // All requested places are inserted in one PostgreSQL statement.
      // A UNIQUE violation rejects the whole statement; no existing slots are changed.
      const { data, error: insertError } = await supabase.from('besico_lagerplaetze')
        .insert(newPlaces).select('id,bereich_id,ebene,platz_nummer');
      if (insertError || !data || data.length !== newPlaces.length) {
        throw insertError ?? new Error('Es wurden nicht alle Plätze bestätigt. Bitte aktualisieren.');
      }
      setPlaces(previous => [...previous, ...(data as LagerPlatz[])]);
      setFirstNumber(String(first + count));
      setStructureMessage(`${count} Lagerplätze in ${selectedArea.typ} „${selectedArea.name}“, Ebene „${ebene}“, angelegt.`);
    } catch (cause) {
      setStructureError('Plätze anlegen: ' + (cause instanceof Error ? cause.message : String(cause)));
    } finally {
      setStructureSaving(false);
    }
  }

  // Keep old Glauchau-style stacks/levels visually familiar, while only
  // using the new independent layout tables for these branches.
  const naturalSort = (a: string, b: string) => a.localeCompare(b, 'de', { numeric: true });
  const levelSort = (a: string, b: string) => {
    const preferredOrder: Record<string, number> = { Oben: 0, Mitte: 1, Unten: 2 };
    const priority = (level: string) => preferredOrder[level] ?? 3;
    return priority(a) - priority(b) || naturalSort(a, b);
  };
  const canDeleteStructure = warehouseWheelCount === 0 && !layoutBusy;

  const printedAreas = areas.filter(area => area.lager_id === selectedWarehouseId);
  const printAreaOptions = [...printedAreas].sort((a, b) => a.name.localeCompare(b.name, 'de', { numeric: true }));
  const escPrint = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;')
    .replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

  function printBranchList() {
    if (!selectedWarehouse || !stockIsVerified || structureReadFailed || stockWorking) {
      setStockError('Druck nicht möglich: Bestand und Lagerstruktur bitte zuerst aktualisieren.');
      return;
    }
    const includedAreas = branchPrintArea === 'all'
      ? printedAreas : printedAreas.filter(area => area.id === branchPrintArea);
    const printableSlots = newWarehouseSlots
      .filter(slot => includedAreas.some(area => area.id === slot.area.id))
      .sort((a, b) => a.area.name.localeCompare(b.area.name, 'de', { numeric: true }) ||
        a.place.platz_nummer.localeCompare(b.place.platz_nummer, 'de', { numeric: true }) ||
        levelSort(a.place.ebene, b.place.ebene));
    const lines: { gruppe: string; ebene: string; platz: string; kennzeichen: string; beleg: string }[] = [];
    for (const slot of printableSlots) {
      const sets = stockForPlace(slot.label);
      if (sets.length) {
        for (const set of sets) lines.push({ gruppe: `${slot.area.typ} ${slot.area.name}`,
          ebene: slot.place.ebene, platz: slot.label, kennzeichen: set.kennzeichen || 'Ohne Kennzeichen', beleg: set.belegnummer || '' });
      } else if (branchPrintFree) {
        lines.push({ gruppe: `${slot.area.typ} ${slot.area.name}`, ebene: slot.place.ebene,
          platz: slot.label, kennzeichen: 'Frei', beleg: '' });
      }
    }
    // Only truly unassigned or older unrecognized locations, and never a set
    // from another branch/warehouse. They must not disappear from the printout.
    for (const set of warehouseStock) {
      if (branchPrintArea !== 'all' && !printableSlots.some(slot => norm(slot.label) === norm(set.lagerplatz))) continue;
      if (printableSlots.some(slot => norm(slot.label) === norm(set.lagerplatz))) continue;
      lines.push({ gruppe: 'Nicht zugeordnet', ebene: '—', platz: set.lagerplatz || 'Ohne Lagerplatz',
        kennzeichen: set.kennzeichen || 'Ohne Kennzeichen', beleg: set.belegnummer || '' });
    }
    const groupName = branchPrintArea === 'all' ? 'Alle Regale / Reihen'
      : (printAreaOptions.find(area => area.id === branchPrintArea)?.name || 'Gruppe');
    const now = new Date().toLocaleString('de-DE');
    const rowMarkup = lines.map(line => `<tr><td>${escPrint(line.gruppe)}</td><td>${escPrint(line.ebene)}</td><td>${escPrint(line.platz)}</td><td>${escPrint(line.kennzeichen)}</td><td>${escPrint(line.beleg)}</td><td class="check">&#9633;</td></tr>`).join('');
    const popup = window.open('', '_blank');
    if (!popup) { setStockError('Druckfenster blockiert. Bitte Pop-ups für BESICO zulassen.'); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>BESICO Lagerliste - ${escPrint(standortName)} - ${escPrint(selectedWarehouse.name)}</title><style>
      body{font:12px Arial,sans-serif;color:#182b44;margin:22px}h1{font-size:20px;margin:0 0 5px}h2{font-size:15px;margin:0 0 14px}.meta{color:#555;margin-bottom:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #9aa8b9;padding:6px;text-align:left}th{background:#eaf0f7}.check{text-align:center;font-size:19px;width:55px}tr{break-inside:avoid}thead{display:table-header-group}.actions{margin-bottom:20px}button{padding:9px 15px;cursor:pointer}@media print{.actions{display:none}body{margin:0}@page{size:A4;margin:12mm}}
    </style></head><body><div class="actions"><button onclick="window.print()">Drucken</button></div><h1>BESICO REIFENLAGER</h1><h2>Lagerliste · ${escPrint(standortName)} · ${escPrint(selectedWarehouse.name)} · ${escPrint(groupName)}</h2><div class="meta">Erstellt: ${escPrint(now)} · ${lines.length} Zeilen · ${branchPrintFree ? 'inkl. freier Plätze' : 'nur belegte Plätze'} · Lager: ${escPrint(selectedWarehouse.name)}</div><table><thead><tr><th>Regal / Reihe</th><th>Ebene</th><th>Lagerplatz</th><th>Kennzeichen</th><th>Beleg</th><th>Kontrolle</th></tr></thead><tbody>${rowMarkup || '<tr><td colspan="6">Keine Einträge für diese Auswahl.</td></tr>'}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
  }

  function showStockPlace(item: BranchRadsatz) {
    const warehouse = availableWarehouses.find(entry => entry.id === item.besico_lager_id);
    if (!warehouse || !item.lagerplatz?.trim()) {
      setStockMessage(`${item.kennzeichen || 'Radsatz'}: Noch kein Lagerplatz zugewiesen.`);
      return;
    }
    const place = newWarehouseSlots.find(slot => norm(slot.label) === norm(item.lagerplatz));
    setSelectedWarehouseId(warehouse.id);
    setSelectedPlanPlaceId(warehouse.id === selectedWarehouseId ? (place?.place.id ?? '') : '');
    setStockMessage(`${item.kennzeichen || 'Radsatz'}: ${warehouse.name} / ${item.lagerplatz}`);
    window.setTimeout(() => document.getElementById('filiale-lagerplan')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  }

  function placeTile(place: LagerPlatz) {
    const slot = newWarehouseSlots.find(item => item.place.id === place.id);
    const here = slot ? stockForPlace(slot.label) : [];
    const isFree = planIsVerified && !here.length;
    const hover = dropHoverPlaceId === place.id && isFree;
    const selectedForAssignment = assignPlaceId === place.id || selectedPlanPlaceId === place.id;
    const color = !planIsVerified ? '#e2e8f0' : here.length > 1 ? '#fed7aa' : here.length ? '#fecaca' : '#dcfce7';
    const verifiedEmpty = warehouseWheelCount === 0;
    // As in the original Glauchau plan, an occupied place is a drag source.
    // Never allow dragging an unverified or multiply occupied cell.
    const canDragWheel = planIsVerified && physicalWarehouseSelected && !stockWorking &&
      !layoutBusy && here.length === 1;
    return <div key={place.id}
      title={canDragWheel ? `${slot?.label || ''}: Radsatz auf einen freien Platz ziehen` : (slot?.label || `${place.ebene} / ${place.platz_nummer}`)}
      draggable={canDragWheel}
      onDragStart={event => { if (canDragWheel) onBranchDragStart(event, here[0].id); else event.preventDefault(); }}
      onDragEnd={() => { setDraggedStockId(null); setDropHoverPlaceId(null); }}
      onDragOver={event => onBranchDragOver(event, place.id)}
      onDragLeave={() => setDropHoverPlaceId(old => old === place.id ? null : old)}
      onDrop={event => onBranchDrop(event, place.id)}
      style={{ border: hover ? '3px dashed #2563eb' : selectedForAssignment ? '3px solid #2563eb' : '1px solid #cbd5e1',
        background: hover ? '#bfdbfe' : color, borderRadius: 7, minHeight: 48,
        padding: '5px 3px', textAlign: 'center', display: 'flex', flexDirection: 'column',
        cursor: canDragWheel ? 'grab' : 'default',
        justifyContent: 'center', gap: 3, color: '#172b4d', fontSize: 11 }}>
      <strong>{place.ebene}</strong>
      <small style={{ fontSize: 10 }}>{!planIsVerified ? `Platz ${place.platz_nummer} · ungeprüft` :
        here.length > 1 ? `${here.length} Radsätze!` : here.length ? here[0].kennzeichen : `Platz ${place.platz_nummer} · Frei`}</small>
      {isFree && physicalWarehouseSelected && <button type="button" style={{ ...btn, fontSize: 10, padding: '3px 5px' }}
        onClick={() => {
          setAssignPlaceId(place.id);
          setSelectedPlanPlaceId(place.id);
          setStockMessage('Freier Platz ausgewählt. Unten einen Radsatz auswählen und „Platz zuweisen“ drücken.');
          document.getElementById('filiale-radsaetze')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }}>
        Platz wählen
      </button>}
      {canDeleteStructure && verifiedEmpty && <button type="button" title="Lagerplatz löschen" aria-label={`Platz ${place.ebene} ${place.platz_nummer} löschen`}
        onClick={() => void deletePlace(place)} style={{ ...btn, color: '#b91c1c', border: 'none', padding: '2px 4px', fontSize: 10, alignSelf: 'center' }}>
        <Trash2 size={12} style={{ verticalAlign: 'middle' }} /> Platz löschen
      </button>}
    </div>;
  }

  return <section className="besico-branch-lager" style={{ width: '100%', maxWidth: 'none', minWidth: 0 }}
    onDragOver={event => {
      if (!draggedStockId || !planIsVerified) return;
      if (event.clientY < 100) window.scrollBy(0, -28);
      else if (event.clientY > window.innerHeight - 100) window.scrollBy(0, 28);
    }}>
    <h1>Lagerplan · {standortName}</h1>
    <p style={{ color: '#64748b' }}>Jede Filiale verwaltet ihre eigenen Lager. Die vorhandenen Lager und Radsätze aus Glauchau bleiben unverändert.</p>
    <style>{`
      .besico-branch-lager .besico-branch-layout { display:grid; gap:0; align-items:start; min-width:0; }
      .besico-branch-lager .besico-branch-layout.tools-closed { grid-template-columns: minmax(0, 1fr) !important; }
      .besico-branch-lager .besico-tool-resize { cursor:col-resize; touch-action:none; align-self:stretch; min-height:350px; background:transparent; display:flex; align-items:flex-start; justify-content:center; padding-top:18px; }
      .besico-branch-lager .besico-tool-resize:hover, .besico-branch-lager .besico-tool-resize:focus-visible { background:#e2e8f0; }
      .besico-branch-lager .besico-tool-resize::before { content:''; display:block; height:76px; width:3px; border-radius:6px; background:#94a3b8; }
      .besico-branch-lager .besico-warehouse-toolbar { position:sticky; top:0; z-index:15; background:#fff; }
      .besico-branch-lager .besico-tool-panel { min-width:0; max-height:calc(100vh - 32px); overflow-y:auto; position:sticky; top:12px; padding-right:3px; }
      .besico-branch-lager .besico-tool-panel > div { padding:12px !important; margin-bottom:10px !important; }
      .besico-branch-lager .besico-tool-panel h2 { font-size:15px; margin:0 0 9px !important; }
      .besico-branch-lager .besico-tool-panel h3 { font-size:13px; margin:12px 0 8px; }
      .besico-branch-lager .besico-tool-panel label { min-width:0; max-width:100%; }
      .besico-branch-lager .besico-tool-panel input:not([type=checkbox]), .besico-branch-lager .besico-tool-panel select { max-width:100%; min-width:0; box-sizing:border-box; }
      .besico-branch-lager .besico-tool-panel button { max-width:100%; white-space:normal; }
      .besico-branch-lager .besico-main-panel { min-width:0; padding-left:12px; }
      @media (max-width: 850px) {
        .besico-branch-lager .besico-branch-layout { display:block; }
        .besico-branch-lager .besico-tool-panel { position:static; max-height:none; overflow:visible; padding-right:0; margin-bottom:12px; }
        .besico-branch-lager .besico-tool-resize { display:none !important; }
        .besico-branch-lager .besico-main-panel { padding-left:0; }
        .besico-branch-lager .besico-warehouse-toolbar { top:0; }
      }
    `}</style>
    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:10, flexWrap:'wrap', margin:'0 0 10px' }}>
      <button type="button" aria-expanded={toolsOpen} aria-controls="besico-branch-tools" onClick={() => setToolsOpen(value => !value)}
        style={{ ...btn, background: toolsOpen ? '#e2e8f0' : '#12365a', color: toolsOpen ? '#12365a' : '#fff', display:'inline-flex', gap:7, alignItems:'center' }}>
        {toolsOpen ? '◀ Werkzeuge ausblenden' : '▶ Werkzeuge anzeigen'}
      </button>
      <span style={{ color:'#64748b', fontSize:12 }}>Lagerplan · {selectedWarehouse?.name || standortName}</span>
    </div>
    <div className="besico-warehouse-toolbar" style={{ border: '1px solid #dbe3ee', borderRadius: 12, marginBottom: 12, padding: 10 }}>
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Lager auswählen</h2>
      {loading ? <p>Lager werden geladen...</p> : <div role="group" aria-label={`Lager in ${standortName}`} style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {availableWarehouses.filter(item => !hideEmptyIncoming || item.id !== incomingWarehouse?.id).map(item => <button type="button" key={item.id} disabled={saving || structureSaving || stockWorking}
          aria-pressed={selectedWarehouseId === item.id}
          onClick={() => setSelectedWarehouseId(item.id)}
          style={{ ...btn, background: selectedWarehouseId === item.id ? '#12365a' : '#fff',
            color: selectedWarehouseId === item.id ? '#fff' : '#12365a', borderColor: selectedWarehouseId === item.id ? '#12365a' : '#cbd5e1' }}>
          {item.name}
        </button>)}
      </div>}
      {!loading && !availableWarehouses.length && !error && <p>Für diese Filiale wurde noch kein Lager angelegt.</p>}
      {selectedWarehouse && <p style={{ color: '#475569', marginBottom: 0 }}>Ausgewähltes Lager: <strong>{selectedWarehouse.name}</strong></p>}
    </div>
    </div>
    <div className={'besico-branch-layout' + (toolsOpen ? '' : ' tools-closed')}
      style={{ gridTemplateColumns: toolsOpen ? `${toolsWidth}px 10px minmax(0, 1fr)` : 'minmax(0, 1fr)' }}>
      <aside id="besico-branch-tools" className="besico-tool-panel" style={{ display: toolsOpen ? 'block' : 'none' }} aria-label="Lagerverwaltung Werkzeuge">
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <button type="button" style={{ ...btn, display: 'inline-flex', alignItems: 'center', gap: 7,
        background: quickBranchOpen ? '#e2e8f0' : '#12365a', color: quickBranchOpen ? '#12365a' : '#fff' }}
        onClick={() => setQuickBranchOpen(value => !value)}><ClipboardPlus size={18} /> + Schnellaufnahme</button>
      {quickBranchOpen && <div style={{ marginTop: 14 }}>
        <h2 style={{ margin: '0 0 8px' }}>Radsatz schnell erfassen</h2>
        <p style={{ fontSize: 13, color: '#64748b' }}>Neuer Radsatz in {standortName} · {selectedWarehouse?.name || 'Bitte Lager wählen'}. Erst Kennzeichen und freien Lagerplatz prüfen.</p>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Kennzeichen *
            <input value={quickBranchPlate} maxLength={32} onChange={event => { setQuickBranchPlate(event.target.value); setQuickBranchCreatedId(''); }}
              placeholder="z. B. GC-S 140" style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} />
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Freier Lagerplatz *
            <select value={quickBranchPlaceId} onChange={event => setQuickBranchPlaceId(event.target.value)}
              disabled={!planIsVerified || !physicalWarehouseSelected || stockWorking}
              style={{ ...btn, minWidth: 205, maxWidth: '100%' }}>
              <option value="">Bitte auswählen</option>
              {freeNewSlots.map(slot => <option key={slot.place.id} value={slot.place.id}>{slot.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Bemerkung (optional)
            <input value={quickBranchNote} maxLength={500} onChange={event => setQuickBranchNote(event.target.value)}
              placeholder="z. B. 4 Winterräder" style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} />
          </label>
          <button type="button" style={{ ...btn, background: '#166534', color: '#fff' }}
            disabled={stockWorking || !planIsVerified || !physicalWarehouseSelected || !quickBranchPlate.trim() || !quickBranchPlaceId}
            onClick={() => void quickAddBranch()}>Speichern</button>
        </div>
        {!planIsVerified && <p style={{ color: '#92400e', fontSize: 12 }}>Nur nach Prüfung der Platzbelegung verfügbar.</p>}
        {quickBranchCreatedId && <p style={{ color: '#166534', fontWeight: 700 }}>Gespeichert! <a href={qrUrl(quickBranchCreatedId)}>Schein / QR öffnen</a></p>}
        <p style={{ color: '#64748b', fontSize: 12 }}>Schnellaufnahme wird als „Unvollständig“ markiert. Der Kundeneinlagerungsschein muss später ergänzt werden.</p>
      </div>}
    </div>
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', display: 'flex', gap: 8, alignItems: 'center' }}><Printer size={20} /> Lagerliste drucken</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'end' }}>
        <div style={{ display: 'grid', gap: 5, fontSize: 13 }}>Lager
          <strong>{selectedWarehouse?.name || 'Bitte auswählen'}</strong>
        </div>
        <label style={{ display: 'grid', gap: 5, fontSize: 13 }}>Regal / Reihe
          <select style={btn} value={branchPrintArea} onChange={event => setBranchPrintArea(event.target.value)} disabled={!selectedWarehouse}>
            <option value="all">Alle Regale / Reihen</option>
            {printAreaOptions.map(area => <option key={area.id} value={area.id}>{area.typ} {area.name}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, paddingBottom: 9 }}>
          <input type="checkbox" checked={branchPrintFree} onChange={event => setBranchPrintFree(event.target.checked)} /> Freie Plätze mitdrucken
        </label>
        <button type="button" disabled={!selectedWarehouse || !stockIsVerified || structureReadFailed || stockWorking}
          style={{ ...btn, background: '#12365a', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          onClick={printBranchList}><Printer size={16} /> Liste drucken</button>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 0 }}>Druckt ausschließlich den Bestand von {standortName} / {selectedWarehouse?.name || 'ausgewähltem Lager'}. Radsätze ohne zugewiesenen Lagerplatz werden bei „Alle Regale / Reihen“ mitgedruckt. Keine Änderungen an Radsätzen oder Inventur.</p>
    </div>
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Neues Lager anlegen</h2>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 6, flex: '1 1 230px', maxWidth: 400 }}>
          Lagername
          <input value={newWarehouseName} maxLength={60} onChange={event => setNewWarehouseName(event.target.value)} placeholder="z. B. Halle 1, Außenlager, Zelt" style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} />
        </label>
        <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }} disabled={loading || saving || !newWarehouseName.trim()} onClick={() => void createWarehouse()}>
          <Plus size={15} style={{ verticalAlign: 'middle' }} /> {saving ? 'Wird angelegt...' : 'Lager anlegen'}
        </button>
      </div>
      {error && <p role="alert" style={{ color: '#b91c1c' }}>{error}</p>}
      {message && <p role="status" style={{ color: '#166534' }}>{message}</p>}
    </div>
    {selectedWarehouse && <div id="filiale-lagerplan" style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Lagerstruktur · {selectedWarehouse.name}</h2>
      <p style={{ color: '#64748b', fontSize: 13 }}>Regale, Reihen oder Bereiche anlegen. Danach Ebenen und Lagerplätze selbst festlegen. Es werden nur Daten dieses Lagers angezeigt.</p>
      {structureLoading && <p>Lagerstruktur wird geladen...</p>}
      {structureError && <p role="alert" style={{ color: '#b91c1c', fontWeight: 600 }}>{structureError} <button type="button" style={btn} onClick={() => { setStructureError(''); setStructureReload(n => n + 1); }}>Aktualisieren</button></p>}
      {structureMessage && <p role="status" style={{ color: '#166534' }}>{structureMessage}</p>}
      {!structureLoading && <>
        <h3>Neues Regal / neue Reihe</h3>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 10, marginBottom: 16 }}>
          <label style={{ display: 'grid', gap: 6 }}>Typ
            <select value={newAreaType} onChange={event => setNewAreaType(event.target.value as BereichTyp)} style={btn} disabled={layoutBusy}>
              <option value="Regal">Regal</option><option value="Reihe">Reihe</option><option value="Bereich">Bereich</option>
            </select>
          </label>
          <label style={{ display: 'grid', gap: 6, flex: '1 1 180px', maxWidth: 320 }}>Name
            <input value={newAreaName} onChange={event => setNewAreaName(event.target.value)} maxLength={60} placeholder="z. B. Regal A, Reihe 1" style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} disabled={layoutBusy} />
          </label>
          {newAreaType === 'Reihe' && <label style={{ display: 'grid', gap: 6, width: 165 }}>Stapel pro Reihe
            <input type="number" min={1} max={100} step={1} value={rowStackCount} onChange={event => setRowStackCount(event.target.value)}
              disabled={layoutBusy} style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', boxSizing: 'border-box' }} />
          </label>}
          <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }} onClick={() => void createArea()} disabled={layoutBusy || !newAreaName.trim()}>
            <Plus size={15} style={{ verticalAlign: 'middle' }} /> {newAreaType === 'Reihe' ? 'Reihe mit Plätzen anlegen' : 'Regal / Bereich anlegen'}
          </button>
        </div>
        <h3>Ebenen und Lagerplätze hinzufügen</h3>
        {areas.length === 0 ? <p>Bitte zuerst ein Regal, eine Reihe oder einen Bereich anlegen.</p> : <>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginBottom: 12 }}>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 200px', maxWidth: 320 }}>Regal / Reihe
              <select value={selectedArea?.id ?? ''} onChange={event => setSelectedAreaId(event.target.value)} disabled={layoutBusy} style={btn}>
                {areas.map(area => <option key={area.id} value={area.id}>{area.typ} · {area.name}</option>)}
              </select>
            </label>
            <label style={{ display: 'grid', gap: 6, flex: '1 1 145px', maxWidth: 230 }}>Ebene
              <input value={levelName} onChange={event => setLevelName(event.target.value)} maxLength={60} placeholder="z. B. Unten, Oben, 4" disabled={layoutBusy} style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8 }} />
            </label>
            <label style={{ display: 'grid', gap: 6, width: 135 }}>Startnummer
              <input type="number" min={1} max={99999} step={1} value={firstNumber} onChange={event => setFirstNumber(event.target.value)} disabled={layoutBusy} style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', boxSizing: 'border-box' }} />
            </label>
            <label style={{ display: 'grid', gap: 6, width: 140 }}>Anzahl Plätze
              <input type="number" min={1} max={100} step={1} value={numberOfPlaces} onChange={event => setNumberOfPlaces(event.target.value)} disabled={layoutBusy} style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, width: '100%', boxSizing: 'border-box' }} />
            </label>
            <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }} disabled={layoutBusy || !selectedArea || !levelName.trim()} onClick={() => void createPlaces()}>
              <Plus size={15} style={{ verticalAlign: 'middle' }} /> Plätze anlegen
            </button>
          </div>
          <p style={{ fontSize: 12, color: '#64748b' }}>Beispiel: Ebene „Unten“, Startnummer 1, Anzahl 3 ergibt die Plätze 01, 02, 03. Für weitere Ebenen einfach den Ebenennamen ändern. Pro Vorgang sind bis zu 100 Plätze möglich.</p>
          {selectedArea?.typ === 'Reihe' && <div style={{ border: '1px dashed #cbd5e1', padding: 12, borderRadius: 8, marginBottom: 14 }}>
            <strong>Weitere Stapel hinzufügen (Oben und Unten)</strong>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', marginTop: 8 }}>
              <label style={{ display: 'grid', gap: 5 }}>Erster neuer Stapel
                <input type="number" min={1} max={99999} value={extraStackStart} onChange={event => setExtraStackStart(event.target.value)} disabled={layoutBusy}
                  style={{ padding: 9, width: 125, borderRadius: 8, border: '1px solid #cbd5e1' }} />
              </label>
              <label style={{ display: 'grid', gap: 5 }}>Anzahl Stapel
                <input type="number" min={1} max={100} value={extraStackCount} onChange={event => setExtraStackCount(event.target.value)} disabled={layoutBusy}
                  style={{ padding: 9, width: 125, borderRadius: 8, border: '1px solid #cbd5e1' }} />
              </label>
              <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }} disabled={layoutBusy} onClick={() => void addStacks()}>
                <Plus size={15} style={{ verticalAlign: 'middle' }} /> Stapel hinzufügen
              </button>
            </div>
          </div>}
        </>}
      </>}
    </div>}
      </aside>
      {toolsOpen && <div className="besico-tool-resize" role="separator" tabIndex={0}
        aria-label="Werkzeugleiste Breite ändern" aria-orientation="vertical" aria-valuemin={220} aria-valuemax={720} aria-valuenow={toolsWidth}
        title="Ziehen, um die Werkzeugleiste breiter oder schmaler zu machen"
        onKeyDown={event => {
          if (event.key === 'ArrowRight') { event.preventDefault(); setToolsWidth(old => Math.min(720, old + 30)); }
          if (event.key === 'ArrowLeft') { event.preventDefault(); setToolsWidth(old => Math.max(220, old - 30)); }
        }}
        onPointerDown={event => {
          if (event.button !== 0) return;
          event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); setResizingTools(true);
        }}
        onPointerMove={event => {
          if (!resizingTools) return;
          const left = event.currentTarget.parentElement?.getBoundingClientRect().left ?? 0;
          const maxWidth = Math.max(220, Math.min(720, window.innerWidth - left - 230));
          setToolsWidth(Math.max(220, Math.min(maxWidth, Math.round(event.clientX - left - 5))));
        }}
        onPointerUp={event => { setResizingTools(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => setResizingTools(false)} />}
      <div className="besico-main-panel">
    <div style={{ scrollMarginTop: 18 }} id="filiale-hinweise">
      {branchStockError && <p role="alert" style={{ color: '#b91c1c', fontWeight: 700 }}>{branchStockError}</p>}
      {stockError && <p role="alert" style={{ color: '#b91c1c', fontWeight: 700 }}>{stockError}</p>}
      {stockMessage && <p role="status" style={{ color: '#166534', fontWeight: 700 }}>{stockMessage}</p>}
      {physicalWarehouseSelected && <p style={{ color: '#475569', fontSize: 13 }}>
        Ziel für die Einlagerung: <strong>{selectedWarehouse?.name}</strong>. Lager oben wechseln, um ein anderes Ziel zu wählen.
      </p>}
      {!planIsVerified && physicalWarehouseSelected && <p style={{ color: '#92400e', fontSize: 12 }}>
        Platzbelegung wird geprüft. Bis alle Lagerplätze eindeutig erkannt sind, ist das Verschieben gesperrt.
      </p>}
      {unmatchedPlaces.length > 0 && <p role="alert" style={{ color: '#92400e', fontSize: 12 }}>
        {unmatchedPlaces.length} gespeicherte Lagerplätze konnten nicht eindeutig einer Zelle zugeordnet werden. Bitte zuerst prüfen.
      </p>}
      {!slotNamesAreUnique && <p role="alert" style={{ color: '#b91c1c', fontSize: 12 }}>
        Mehrere Lagerplätze haben dieselbe Bezeichnung. Zur Sicherheit ist das Verschieben gesperrt.
      </p>}


    </div>

    {assignStock && <div id="filiale-platz-zuweisen" style={{ background: '#fff', border: '2px solid #2563eb', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 8px' }}>Lagerplatz zuweisen · {assignStock.kennzeichen || assignStock.belegnummer || 'Radsatz'}</h2>
      <p style={{ fontSize: 13, color: '#64748b' }}>Aktuelles Lager: {availableWarehouses.find(item => item.id === assignStock.besico_lager_id)?.name || '—'} · Aktueller Platz: {assignStock.lagerplatz || 'Nicht zugeordnet'}</p>
      <p style={{ fontSize: 13 }}>Ziel: <strong>{selectedWarehouse?.name || 'Bitte Lager wählen'}</strong>. Nur freie Plätze im ausgewählten Lager.</p>
      {!physicalWarehouseSelected && <p style={{ color: '#92400e', fontSize: 13 }}>Bitte oben das Ziellager auswählen (nicht Wareneingang).</p>}
      {!planIsVerified && physicalWarehouseSelected && <p style={{ color: '#92400e', fontSize: 13 }}>Lagerplätze werden geprüft. Zuordnung ist bis zur sicheren Prüfung gesperrt.</p>}
      {planIsVerified && physicalWarehouseSelected && <div role="group" aria-label="Freier Lagerplatz" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 210px), 1fr))', gap: 6, maxHeight: 220, overflowY: 'auto', padding: 5, border: '1px solid #dbe3ee', borderRadius: 8, marginBottom: 12 }}>
        {freeNewSlots.map(slot => <button type="button" key={slot.place.id}
          disabled={stockWorking}
          aria-pressed={assignPlaceId === slot.place.id}
          onClick={() => { setAssignPlaceId(slot.place.id); setSelectedPlanPlaceId(slot.place.id); }}
          style={{ ...btn, textAlign: 'left', padding: '8px 10px',
            background: assignPlaceId === slot.place.id ? '#12365a' : '#dcfce7',
            color: assignPlaceId === slot.place.id ? '#fff' : '#166534' }}>
          {slot.label}
        </button>)}
        {!freeNewSlots.length && <p style={{ margin: 4, fontSize: 13 }}>Keine freien Lagerplätze vorhanden.</p>}
      </div>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }}
          disabled={!assignPlaceId || !freeNewSlots.some(slot => slot.place.id === assignPlaceId) || stockWorking || !planIsVerified || !physicalWarehouseSelected}
          onClick={() => void moveBranchStock(assignStock.id, assignPlaceId)}>Speichern</button>
        <button type="button" style={btn} onClick={() => { setAssignStockId(''); setAssignPlaceId(''); }}>Abbrechen</button>
      </div>
    </div>}

    {selectedWarehouse && <div id="filiale-lagerplan" style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 12, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 8px' }}>Lagerplan · {selectedWarehouse.name}</h2>
      {structureLoading && <p>Lagerstruktur wird geladen...</p>}
      {!structureLoading && <>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <h3>Übersicht der Lagerplätze</h3>
          <button type="button" style={btn} disabled={structureSaving} onClick={() => setStructureReload(n => n + 1)}><RefreshCw size={15} style={{ verticalAlign: 'middle' }} /> Aktualisieren</button>
        </div>
        {warehouseWheelCount === null && <p style={{ color: '#92400e', fontSize: 13 }}>Belegung nicht überprüft: Plätze werden vorsichtshalber nicht als frei markiert. Löschen gesperrt.</p>}
        {warehouseWheelCount !== null && warehouseWheelCount > 0 && <p style={{ color: '#92400e', fontSize: 13 }}>In diesem Lager sind {warehouseWheelCount} Radsätze gespeichert. Struktur löschen ist zum Schutz der Radsätze gesperrt.</p>}
        {areas.length === 0 && <p>In diesem Lager wurden noch keine Regale oder Reihen angelegt.</p>}
        {areas.some(area => area.typ === 'Reihe') && <>
          <h3 style={{ marginTop: 18 }}>Lagerplan · Reihen</h3>
          <p style={{ color: '#64748b', fontSize: 12 }}>Wie im bisherigen Lagerplan: Jede Reihe enthält Stapel mit den Ebenen Oben und Unten. Die Anzahl der Stapel wird beim Anlegen festgelegt.</p>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 125px), 1fr))', gap: 10, alignItems: 'start' }}>
            {areas.filter(area => area.typ === 'Reihe').sort((a, b) => naturalSort(a.name, b.name)).map(area => {
              const areaPlaces = places.filter(place => place.bereich_id === area.id);
              const stacks = [...new Set(areaPlaces.map(place => place.platz_nummer))].sort((a, b) => naturalSort(b, a));
              const levels = [...new Set(areaPlaces.map(place => place.ebene))].sort(levelSort);
              return <div key={area.id} style={{ padding: 8, border: '1px solid #dbe3ee', borderRadius: 10, background: '#fff', minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 4, justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{area.name}</strong>
                  <button type="button" title="Reihe löschen" aria-label={`Reihe ${area.name} löschen`}
                    style={{ ...btn, color: '#b91c1c', padding: '5px 7px' }} disabled={!canDeleteStructure} onClick={() => void deleteArea(area)}><Trash2 size={15} /></button>
                </div>
                {stacks.length === 0 && <p style={{ fontSize: 12, color: '#64748b' }}>Noch keine Stapel angelegt.</p>}
                <div style={{ display: 'grid', gap: 6 }}>
                  {stacks.map(stack => <div key={stack} style={{ border: '1px solid #dbe3ee', borderRadius: 8, padding: 4 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 3, marginBottom: 4 }}>
                      <strong style={{ fontSize: 11 }}>Stapel {Number(stack) || stack}</strong>
                      {canDeleteStructure && <button type="button" title={`Stapel ${stack} löschen`} aria-label={`Stapel ${stack} löschen`}
                        style={{ ...btn, padding: 2, color: '#b91c1c', border: 'none' }} onClick={() => void deleteStack(area, stack)}><Trash2 size={12} /></button>}
                    </div>
                    <div style={{ display: 'grid', gap: 2 }}>
                      {levels.map(level => {
                        const place = areaPlaces.find(p => p.platz_nummer === stack && p.ebene === level);
                        return place ? placeTile(place) : <div key={level} style={{ background: '#f1f5f9', padding: 6, textAlign: 'center', color: '#94a3b8', borderRadius: 6, fontSize: 11 }}>{level} · —</div>;
                      })}
                    </div>
                  </div>)}
                </div>
                <p style={{ color: '#64748b', fontSize: 11, margin: '7px 0 0' }}>{areaPlaces.length} Lagerplätze</p>
              </div>;
            })}
          </div>
        </>}
        {areas.some(area => area.typ !== 'Reihe') && <>
          <h3 style={{ marginTop: 20 }}>Regale und Bereiche</h3>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10, alignItems: 'start' }}>
            {areas.filter(area => area.typ !== 'Reihe').sort((a, b) => naturalSort(a.name, b.name)).map(area => {
              const areaPlaces = places.filter(place => place.bereich_id === area.id);
              const levels = [...new Set(areaPlaces.map(place => place.ebene))].sort(levelSort);
              return <div key={area.id} style={{ border: '1px solid #dbe3ee', borderRadius: 10, padding: 10, background: '#fff' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 5 }}>
                  <strong style={{ fontSize: 13, overflowWrap: 'anywhere' }}>{area.typ} {area.name}</strong>
                  <button type="button" title={`${area.typ} löschen`} aria-label={`${area.typ} ${area.name} löschen`}
                    style={{ ...btn, color: '#b91c1c', padding: '5px 7px' }} disabled={!canDeleteStructure} onClick={() => void deleteArea(area)}><Trash2 size={15} /></button>
                </div>
                {levels.length === 0 && <p style={{ fontSize: 12, color: '#64748b' }}>Noch keine Ebenen oder Plätze angelegt.</p>}
                <div style={{ display: 'grid', gap: 8, marginTop: 10 }}>
                  {levels.map(level => <div key={level}>
                    <strong style={{ display: 'block', fontSize: 11, marginBottom: 4 }}>{level}</strong>
                    <div style={{ display: 'grid', gap: 4 }}>
                      {areaPlaces.filter(place => place.ebene === level).sort((a, b) => naturalSort(a.platz_nummer, b.platz_nummer)).map(place => placeTile(place))}
                    </div>
                  </div>)}
                </div>
                <p style={{ color: '#64748b', fontSize: 11, margin: '7px 0 0' }}>{areaPlaces.length} Lagerplätze</p>
              </div>;
            })}
          </div>
        </>}
      </>}
    </div>}
      </div>
    </div>
    <div id="filiale-radsaetze" style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginBottom: 16 }}>
      <h2 style={{ marginTop: 0 }}>Radsätze — unten · {standortName}</h2>
      <p style={{ color: '#475569', fontSize: 13 }}>
        Hier sind alle Radsätze dieser Filiale sichtbar, auch ohne festen Lagerplatz.
        Lager oben auswählen, mit „Platz zuweisen“ einen freien Platz wählen oder eine Karte nach oben auf eine grüne Zelle ziehen.
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        <strong>Gesamt: {branchStockLoading ? '…' : visibleBranchStock.length}</strong>
        <span>Wareneingang: <strong>{branchStockLoading ? '…' : incomingCount}</strong></span>
        {selectedWarehouse && <span>{selectedWarehouse.name}: <strong>{branchStockLoading ? '…' : selectedWarehouseCount}</strong></span>}
        <button type="button" style={{ ...btn, display: 'inline-flex', gap: 6, alignItems: 'center' }}
          disabled={branchStockLoading || loading} onClick={() => setBranchStockRefresh(value => value + 1)}>
          <RefreshCw size={15} /> Bestand aktualisieren
        </button>
        {incomingWarehouse && selectedWarehouseId !== incomingWarehouse.id && <button type="button" style={btn}
          onClick={() => setSelectedWarehouseId(incomingWarehouse.id)}>Wareneingang auswählen</button>}
      </div>

      {branchStockLoading ? <p>Radsätze werden geladen...</p> : !branchStockError && <>
        <label style={{ display: 'grid', gap: 5, marginBottom: 12, maxWidth: 440 }}>
          Radsätze suchen
          <input value={branchStockQuery} onChange={event => setBranchStockQuery(event.target.value)}
            placeholder="Kennzeichen, Beleg, Excel-Lagerplatz ..."
            style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
        </label>
        {visibleBranchStock.length === 0 && <p>Für diese Filiale wurden keine Radsätze gefunden. Bitte das Ergebnis unter „Excel Import / Export“ prüfen.</p>}
        {visibleBranchStock.length > 0 && filteredBranchStock.length === 0 && <p>Keine Radsätze für diesen Suchbegriff.</p>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 270px), 1fr))', gap: 10 }}>
          {filteredBranchStock.slice(0, 100).map(item => {
            const warehouse = availableWarehouses.find(entry => entry.id === item.besico_lager_id);
            const previousArea = String(item.daten?.bereich_alt ?? '').trim();
            const previousPlace = String(item.daten?.lagerplatz_alt ?? '').trim();
            return <article key={item.id} draggable={!stockWorking && planIsVerified && physicalWarehouseSelected}
              onDragStart={event => onBranchDragStart(event, item.id)}
              onDragEnd={() => { setDraggedStockId(null); setDropHoverPlaceId(null); }}
              style={{ border: assignStockId === item.id ? '2px solid #2563eb' : '1px solid #dbe3ee',
                borderRadius: 10, padding: 12, background: '#f8fafc', cursor: planIsVerified && physicalWarehouseSelected ? 'grab' : 'default' }}>
              <strong style={{ color: '#12365a', display: 'inline-flex', alignItems: 'center', gap: 5 }}><GripVertical size={16} /> {item.kennzeichen || 'Ohne Kennzeichen'}</strong>
              <p style={{ margin: '7px 0', fontSize: 13 }}>Beleg: {item.belegnummer || '—'}</p>
              <p style={{ margin: '7px 0', fontSize: 13 }}>Lager: <strong>{warehouse?.name || 'Unbekannt'}</strong></p>
              <p style={{ margin: '7px 0', fontSize: 13 }}>Lagerplatz: {item.lagerplatz?.trim() || 'Noch nicht zugewiesen'}</p>
              {(previousArea || previousPlace) && <p style={{ margin: '7px 0', color: '#475569', fontSize: 12 }}>
                Excel (alter Platz): {[previousArea, previousPlace].filter(Boolean).join(' / ')}
              </p>}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
                <a href={qrUrl(item.id)} style={{ ...btn, textDecoration: 'none', display: 'inline-block', fontSize: 12, padding: '6px 10px' }}>
                  <FileText size={14} style={{ verticalAlign: 'middle', marginRight: 5 }} /> Schein / QR
                </a>
                <button type="button" style={{ ...btn, padding: '6px 10px', fontSize: 12 }}
                  onClick={() => showStockPlace(item)}>
                  Platz anzeigen
                </button>
                <button type="button" style={{ ...btn, padding: '6px 10px', fontSize: 12, color: '#2563eb' }}
                  disabled={stockWorking}
                  onClick={() => { setAssignStockId(item.id); setStockError(''); }}>
                  Platz zuweisen
                </button>
                {!!item.lagerplatz.trim() && <button type="button" style={{ ...btn, padding: '6px 10px', fontSize: 12, color: '#166534' }}
                  disabled={stockWorking} onClick={() => void releaseBranchStock(item.id)}>Platz freigeben</button>}
              </div>
            </article>;
          })}
        </div>
        {filteredBranchStock.length > 100 && <p style={{ color: '#64748b', fontSize: 13 }}>
          {filteredBranchStock.length} Treffer. Aus Gründen der Übersichtlichkeit werden die ersten 100 angezeigt. Bitte Suche verwenden.
        </p>}
      </>}
    </div>
    <p style={{ color: '#64748b', fontSize: 13 }}>Beim Excel-Import werden neue Radsätze direkt dem gewählten Lager zugeordnet, zunächst ohne Lagerplatz. Die bestehenden Glauchau-Daten bleiben unverändert.</p>
  </section>;
}

export default function LagerUebersicht({ view, standortId, standortName }: LagerUebersichtProps) {
  const [rows, setRows] = useState<Schein[]>([]);
  // The existing Zelt/Lager layout belongs to Glauchau only. Other branches
  // remain read-only until their own warehouse-place configuration is implemented.
  const isLegacyGlauchau = standortName.trim().toLocaleLowerCase('de-DE') === 'glauchau';
  const [warehouses, setWarehouses] = useState<WarehouseInfo[]>([]);
  const [loadedStandortId, setLoadedStandortId] = useState('');
  const [loadError, setLoadError] = useState('');
  const refreshToken = useRef(0);
  const [regale, setRegale] = useState<string[]>([]);
  const [customPlaces, setCustomPlaces] = useState<string[]>([]);
  const [busy, setBusy] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [excelArea, setExcelArea] = useState('all');
  const [excelRow, setExcelRow] = useState('all');
  const [onlyUnassigned, setOnlyUnassigned] = useState(false);
  const [lager, setLager] = useState<Area>('Zelt');
  const [selected, setSelected] = useState<string | null>(null);
  const [newRegal, setNewRegal] = useState('');
  const [printArea, setPrintArea] = useState<Area>('Zelt');
  const [printGroup, setPrintGroup] = useState('all');
  const [printFree, setPrintFree] = useState(true);
  const [quickOpen, setQuickOpen] = useState(false);
  const [quickPlate, setQuickPlate] = useState('');
  const [quickArea, setQuickArea] = useState<Area>('Zelt');
  const [quickPlace, setQuickPlace] = useState('');
  const [quickNote, setQuickNote] = useState('');
  const [quickCreatedId, setQuickCreatedId] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [releaseHover, setReleaseHover] = useState(false);
  const [assignId, setAssignId] = useState<string | null>(null);
  const [assignArea, setAssignArea] = useState<Area>('Zelt');
  const [assignPlace, setAssignPlace] = useState('');
  const [highlightedId, setHighlightedId] = useState<string | null>(null);

  async function refresh() {
    const token = ++refreshToken.current;
    setBusy(true);
    setLoadError('');
    setError('');
    setRows([]);
    setRegale([]);
    setCustomPlaces([]);
    setWarehouses([]);
    setLoadedStandortId('');
    try {
      if (!standortId || !isLegacyGlauchau) return;

      // Only documented columns are used. Fail closed if branch mapping cannot
      // be verified: showing all Radsätze here would mix the branches.
      const { data: storageData, error: storageError } = await supabase
        .from('besico_lager').select('id,standort_id,name').eq('standort_id', standortId);
      if (token !== refreshToken.current) return;
      if (storageError) throw new Error('Lagerzuordnung: ' + storageError.message);
      const branchWarehouses = (storageData ?? []) as WarehouseInfo[];
      const zeltWarehouse = branchWarehouses.find(w => norm(w.name) === 'ZELT');
      const lagerWarehouse = branchWarehouses.find(w => norm(w.name) === 'LAGER');
      if (!zeltWarehouse || !lagerWarehouse || zeltWarehouse.id === lagerWarehouse.id) {
        throw new Error('Die Lager „Zelt“ und „Lager“ sind für Glauchau nicht eindeutig zugeordnet. Keine Änderungen möglich.');
      }

      const warehouseIds = [zeltWarehouse.id, lagerWarehouse.id];
      const [scheine, shelves, custom] = await Promise.all([
        supabase.from('reifenlager_scheine')
          .select('id,belegnummer,kennzeichen,lager,lagerplatz,daten,erstellt_am,besico_lager_id')
          .in('besico_lager_id', warehouseIds).order('erstellt_am', { ascending: false }),
        supabase.from('reifenlager_regale').select('nummer').order('nummer'),
        supabase.from('reifenlager_einzelplaetze').select('bezeichnung').order('bezeichnung'),
      ]);
      if (token !== refreshToken.current) return;
      const problems = [scheine.error && `Radsätze: ${scheine.error.message}`, shelves.error && `Regale: ${shelves.error.message}`, custom.error && `Einzelplätze: ${custom.error.message}`].filter(Boolean);
      if (problems.length) throw new Error(problems.join(' | '));
      setWarehouses(branchWarehouses);
      setRows((scheine.data ?? []) as Schein[]);
      setRegale((shelves.data ?? []).map(r => String(r.nummer)));
      setCustomPlaces((custom.data ?? []).map(r => String(r.bezeichnung)));
      setLoadedStandortId(standortId);
    } catch (e) {
      if (token === refreshToken.current) {
        setLoadError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      if (token === refreshToken.current) setBusy(false);
    }
  }

  useEffect(() => {
    void refresh();
    return () => { refreshToken.current += 1; };
  }, [standortId, standortName]);
  useEffect(() => { if (assignId) document.getElementById('lager-assign')?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }, [assignId]);
  useEffect(() => {
    if (!highlightedId) return;
    // Wait until a cleared search filter has rendered the target card.
    const scrollTimer = window.setTimeout(() => {
      document.getElementById(`radsatz-card-${highlightedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 80);
    const clearTimer = window.setTimeout(() => setHighlightedId(null), 5000);
    return () => { window.clearTimeout(scrollTimer); window.clearTimeout(clearTimer); };
  }, [highlightedId]);

  const occupied = useMemo(() => {
    const map = new Map<string, Schein[]>();
    for (const r of rows) {
      if (!r.lagerplatz?.trim()) continue;
      const key = keyOf(r.lager, r.lagerplatz);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return map;
  }, [rows]);
  const at = (place: string, area: Area = lager) => occupied.get(keyOf(area, place)) ?? [];
  const excelAreas = [...new Set(rows.map(oldArea).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  const excelLocations = [...new Set(rows.filter(r => excelArea === 'all' || oldArea(r) === excelArea).map(oldLocation).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b, 'de', { numeric: true }));
  const filtered = rows.filter(r => {
    const values = [r.kennzeichen, r.belegnummer, r.lager, r.lagerplatz, ...Object.values(r.daten ?? {}).filter(v => typeof v === 'string')];
    const words = query.trim().split(/\s+/).filter(Boolean);
    const combined = searchNorm(values.join(' '));
    if (!combined.includes(searchNorm(query)) && !words.every(word => combined.includes(searchNorm(word)))) return false;
    if (excelArea !== 'all' && oldArea(r) !== excelArea) return false;
    if (excelRow !== 'all' && oldLocation(r) !== excelRow) return false;
    if (onlyUnassigned && r.lagerplatz?.trim()) return false;
    return true;
  }).sort((a, b) => {
    const areaCompare = oldArea(a).localeCompare(oldArea(b), 'de', { numeric: true });
    if (areaCompare) return areaCompare;
    const rowCompare = oldPlace(a).localeCompare(oldPlace(b), 'de', { numeric: true });
    return rowCompare || (a.kennzeichen || '').localeCompare(b.kennzeichen || '', 'de', { numeric: true });
  });
  const selectedRows = selected ? at(selected) : [];
  const customLevels = (name: string) => [`${name}-U`, `${name}-M`, `${name}-O`];
  // Preserve any previously occupied legacy single slots until manually moved.
  const legacyCustomPlaces = customPlaces.filter(name => at(name, 'Zelt').length > 0);
  const rackPlaces = [...regale.flatMap(n => [0, 1, 2].map(i => `${n}0${i}`)), ...customPlaces.flatMap(customLevels), ...legacyCustomPlaces];
  const warehousePlaces = Array.from({ length: 6 }, (_, r) => Array.from({ length: 6 }, (_, s) => [`R${r + 1}-${s + 1}-Unten`, `R${r + 1}-${s + 1}-Oben`])).flat(2);
  const printGroups = printArea === 'Zelt'
    ? [...regale.map(name => ({ value: `standard:${name}`, label: `Regal ${name}` })), ...customPlaces.map(name => ({ value: `custom:${name}`, label: `Regal ${name}` }))]
    : Array.from({ length: 6 }, (_, i) => ({ value: `row:${i + 1}`, label: `Reihe ${i + 1}` }));

  function printList() {
    const validGroup = printGroups.some(g => g.value === printGroup) ? printGroup : 'all';
    const positions: { place: string; level: string; group: string }[] = [];
    if (printArea === 'Zelt') {
      for (const name of regale) {
        if (validGroup !== 'all' && validGroup !== `standard:${name}`) continue;
        for (const [index, level] of ['Oben', 'Mitte', 'Unten'].entries()) {
          positions.push({ place: `${name}0${2 - index}`, level, group: `Regal ${name}` });
        }
      }
      for (const name of customPlaces) {
        if (validGroup !== 'all' && validGroup !== `custom:${name}`) continue;
        for (const [index, level] of ['Oben', 'Mitte', 'Unten'].entries()) {
          positions.push({ place: `${name}-${['O', 'M', 'U'][index]}`, level, group: `Regal ${name}` });
        }
        if (legacyCustomPlaces.includes(name)) positions.push({ place: name, level: 'Alter Einzelplatz', group: `Regal ${name}` });
      }
    } else {
      for (let row = 1; row <= 6; row++) {
        if (validGroup !== 'all' && validGroup !== `row:${row}`) continue;
        for (let stack = 1; stack <= 6; stack++) {
          for (const level of ['Oben', 'Unten']) {
            positions.push({ place: `R${row}-${stack}-${level}`, level, group: `Reihe ${row} / Stapel ${stack}` });
          }
        }
      }
    }
    const printable = positions.flatMap(position => {
      const sets = at(position.place, printArea);
      if (!sets.length) return printFree ? [{ ...position, plate: 'Frei', receipt: '' }] : [];
      return sets.map(set => ({ ...position, plate: set.kennzeichen || 'Ohne Kennzeichen', receipt: set.belegnummer || '' }));
    });
    const esc = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    const groupLabel = printGroups.find(g => g.value === validGroup)?.label ?? (printArea === 'Zelt' ? 'Alle Regale' : 'Alle Reihen');
    const now = new Date().toLocaleString('de-DE');
    const tableRows = printable.map(item => `<tr><td>${esc(item.group)}</td><td>${esc(item.level)}</td><td>${esc(item.place)}</td><td>${esc(item.plate)}</td><td>${esc(item.receipt)}</td><td class="check">&#9633;</td></tr>`).join('');
    const popup = window.open('', '_blank');
    if (!popup) { setError('Druckfenster wurde blockiert. Bitte Pop-ups für BESICO erlauben.'); return; }
    popup.document.open();
    popup.document.write(`<!doctype html><html lang="de"><head><meta charset="utf-8"><title>BESICO Lagerliste - ${esc(printArea)} - ${esc(groupLabel)}</title><style>
      body{font:12px Arial,sans-serif;color:#182b44;margin:24px}h1{font-size:20px;margin:0 0 5px}h2{font-size:15px;margin:0 0 15px}.meta{color:#555;margin-bottom:18px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #9aa8b9;padding:7px;text-align:left}th{background:#eaf0f7}.check{text-align:center;font-size:19px;width:55px}tr{break-inside:avoid}thead{display:table-header-group}.actions{margin-bottom:20px}button{padding:9px 15px;cursor:pointer}@media print{.actions{display:none}body{margin:0}@page{size:A4;margin:12mm}}
    </style></head><body><div class="actions"><button onclick="window.print()">Drucken</button></div><h1>BESICO REIFENLAGER</h1><h2>Lagerliste · ${esc(printArea)} · ${esc(groupLabel)}</h2><div class="meta">Erstellt: ${esc(now)} · ${printable.length} Zeilen · ${printFree ? 'inkl. freier Plätze' : 'nur belegte Plätze'}</div><table><thead><tr><th>Regal / Reihe</th><th>Ebene</th><th>Lagerplatz</th><th>Kennzeichen</th><th>Beleg</th><th>Kontrolle</th></tr></thead><tbody>${tableRows || '<tr><td colspan="6">Keine belegten Lagerplätze gefunden.</td></tr>'}</tbody></table></body></html>`);
    popup.document.close();
    popup.focus();
  }
  const warehouseFor = (area: Area) => warehouses.find(w => norm(w.name) === norm(area));
  const currentId = dragged;
  const activeDrag = rows.find(r => r.id === currentId);

  async function quickAdd() {
    const plate = quickPlate.trim().replace(/\s+/g, ' ').toUpperCase();
    if (!plate || plate.length > 32) { setError('Kennzeichen: bitte 1–32 Zeichen eingeben.'); return; }
    if (!quickPlace) { setError('Bitte einen freien Lagerplatz auswählen.'); return; }
    if (working || busy || loadedStandortId !== standortId) return;
    const destinationWarehouse = warehouseFor(quickArea);
    if (!destinationWarehouse) { setError('Lagerzuordnung fehlt. Schnellaufnahme nicht möglich.'); return; }
    setWorking(true); setError(''); setMessage(''); setQuickCreatedId(null);
    try {
      // Recheck against the database immediately before inserting; stale UI must not decide availability.
      const { data: latest, error: readError } = await supabase.from('reifenlager_scheine')
        .select('id,kennzeichen,lager,lagerplatz,besico_lager_id');
      if (readError) throw readError;
      const existing = latest ?? [];
      const samePlate = existing.filter(r => searchNorm(String(r.kennzeichen ?? '')) === searchNorm(plate));
      if (samePlate.length && !window.confirm(`Kennzeichen ${plate} ist bereits ${samePlate.length}× gespeichert. Trotzdem einen weiteren Radsatz anlegen?`)) return;
      if (existing.some(r => r.besico_lager_id === destinationWarehouse.id && norm(r.lagerplatz) === norm(quickPlace))) {
        throw new Error('Lagerplatz ist inzwischen belegt. Bitte aktualisieren und anderen Platz wählen.');
      }
      if (!(quickArea === 'Zelt' ? rackPlaces : warehousePlaces).includes(quickPlace)) {
        throw new Error('Ungültiger Lagerplatz.');
      }
      const receipt = `SCHNELL-${crypto.randomUUID().slice(0, 12).toUpperCase()}`;
      const payload = {
        kennzeichen: plate, belegnummer: receipt, lager: quickArea, lagerplatz: quickPlace, besico_lager_id: destinationWarehouse.id,
        daten: {
          belegnummer: receipt, kennzeichen: plate, lager: quickArea, lagerplatz: quickPlace,
          bemerkung: quickNote.trim(), schnellaufnahme: true, status: 'Unvollständig',
          datum: new Date().toISOString().slice(0, 10)
        }
      };
      const { data: created, error: insertError } = await supabase.from('reifenlager_scheine')
        .insert(payload).select('id').single();
      if (insertError || !created) throw insertError ?? new Error('Speichern fehlgeschlagen.');
      setQuickCreatedId(created.id);
      setMessage(`${plate} → ${quickArea} / ${quickPlace} als Schnellaufnahme gespeichert.`);
      setQuickPlate(''); setQuickNote(''); setQuickPlace('');
      setLager(quickArea); setSelected(payload.lagerplatz);
      await refresh();
    } catch (e) {
      setError('Schnellaufnahme: ' + (e instanceof Error ? e.message : String(e)));
    } finally { setWorking(false); }
  }

  async function addRegal() {
    const name = newRegal.trim().replace(/\s+/g, ' ');
    if (!name || name.length > 54) { setError('Regalname: bitte 1–54 Zeichen eingeben.'); return; }
    if (!/^[\p{L}\p{N} _./-]+$/u.test(name)) { setError('Regalname: nur Buchstaben, Zahlen, Leerzeichen, /, -, _ und Punkt verwenden.'); return; }
    if (regale.some(n => norm(n) === norm(name)) || customPlaces.some(n => norm(n) === norm(name))) { setError('Dieses Regal existiert bereits.'); return; }
    const places = /^\d{4}$/.test(name) ? [0, 1, 2].map(i => `${name}0${i}`) : [`${name}-U`, `${name}-M`, `${name}-O`];
    if (places.some(p => rackPlaces.some(existing => norm(existing) === norm(p)) || at(p, 'Zelt').length > 0)) {
      setError('Ein Lagerplatz mit diesem Namen ist bereits vorhanden.'); return;
    }
    setWorking(true); setError(''); setMessage('');
    const { error: e } = /^\d{4}$/.test(name)
      ? await supabase.from('reifenlager_regale').insert({ nummer: name })
      : await supabase.from('reifenlager_einzelplaetze').insert({ bezeichnung: name });
    if (e) setError('Regal hinzufügen: ' + e.message);
    else { setNewRegal(''); setMessage(`Regal ${name} mit 3 Ebenen hinzugefügt.`); await refresh(); }
    setWorking(false);
  }

  async function deleteCustomRegal(name: string) {
    const places = [name, ...customLevels(name)];
    if (places.some(p => at(p, 'Zelt').length > 0)) { setError(`Regal ${name} ist belegt. Zuerst die Radsätze verschieben.`); return; }
    if (!window.confirm(`Regal ${name} wirklich löschen?`)) return;
    setWorking(true); setError(''); setMessage('');
    const { error: e } = await supabase.from('reifenlager_einzelplaetze').delete().eq('bezeichnung', name);
    if (e) setError('Regal löschen: ' + e.message);
    else { setSelected(null); setMessage(`Regal ${name} gelöscht.`); await refresh(); }
    setWorking(false);
  }

  async function deleteRegal(nummer: string) {
    const places = [0, 1, 2].map(i => `${nummer}0${i}`);
    if (rows.some(r => norm(r.lager) === 'ZELT' && places.some(p => norm(p) === norm(r.lagerplatz)))) {
      setError(`Regal ${nummer} ist belegt. Zuerst die Lagerplätze freigeben oder Radsätze verschieben.`); return;
    }
    if (!window.confirm(`Regal ${nummer} wirklich löschen?`)) return;
    setWorking(true); setError(''); setMessage('');
    const { error: e } = await supabase.from('reifenlager_regale').delete().eq('nummer', nummer);
    if (e) setError('Regal löschen: ' + e.message);
    else { setMessage(`Regal ${nummer} gelöscht.`); setSelected(null); await refresh(); }
    setWorking(false);
  }

  async function moveTo(id: string, place: string, destination: Area = lager) {
    if (working || busy || loadedStandortId !== standortId) return;
    const source = rows.find(r => r.id === id);
    if (!source) { setError('Radsatz nicht gefunden. Bitte aktualisieren.'); return; }
    const destinationWarehouse = warehouseFor(destination);
    if (!destinationWarehouse) { setError('Lagerzuordnung fehlt. Keine Änderung möglich.'); return; }
    if (source.besico_lager_id !== destinationWarehouse.id) {
      setError('Wechsel zwischen Zelt und Lager vorübergehend gesperrt: Die vorhandene Datenbankfunktion muss erst auf besico_lager_id geprüft werden.');
      return;
    }
    if (!(destination === 'Zelt' ? rackPlaces : warehousePlaces).some(p => norm(p) === norm(place))) { setError('Ungültiger Lagerplatz.'); return; }
    if (at(place, destination).some(r => r.id !== id)) { setError('Dieser Lagerplatz ist bereits belegt! Zuerst den vorhandenen Lagerplatz freigeben.'); return; }
    if (keyOf(source.lager, source.lagerplatz) === keyOf(destination, place)) return;
    setWorking(true); setError(''); setMessage('');
    // Existing Glauchau-only movement path. The live RPC and index definitions
    // have not yet been verified, so cross-warehouse moves are blocked above.
    const isCustom = destination === 'Zelt' && customPlaces.some(name => customLevels(name).some(p => norm(p) === norm(place)) || (norm(name) === norm(place) && legacyCustomPlaces.includes(name)));
    // Existing behavior: custom slots use a direct UPDATE. Database-level
    // uniqueness still needs verification before enabling other branches.
    const result = isCustom
      ? await supabase.from('reifenlager_scheine').update({ lager: destination, lagerplatz: place }).eq('id', id).select('id')
      : await supabase.rpc('reifenlager_platz_zuweisen', { p_schein_id: id, p_lager: destination, p_lagerplatz: place });
    const e = result.error;
    const notUpdated = isCustom && !('data' in result && result.data && result.data.length);
    if (e) setError('Platz nicht gespeichert: ' + e.message + ' (Supabase-Berechtigungen prüfen)');
    else if (notUpdated) setError('Platz nicht gespeichert: keine Berechtigung oder Datensatz nicht gefunden.');
    else { setMessage(`${source.kennzeichen || 'Radsatz'} → ${destination} / ${place} gespeichert.`); setLager(destination); setSelected(place); setAssignId(null); setAssignPlace(''); }
    await refresh();
    setWorking(false);
  }

  // Clear only the position. The receipt, QR link and customer data stay intact.
  // The UPDATE policy already installed for the admin allows this change.
  async function releasePlace(id: string) {
    if (working) return;
    const source = rows.find(r => r.id === id);
    if (!source) { setError('Radsatz nicht gefunden. Bitte aktualisieren.'); return; }
    if (!source.lagerplatz?.trim()) { setMessage('Dieser Radsatz hat bereits keinen Lagerplatz.'); return; }
    setWorking(true); setError(''); setMessage('');
    const { data, error: e } = await supabase.from('reifenlager_scheine')
      .update({ lagerplatz: '' }).eq('id', id).select('id');
    if (e) setError('Platz konnte nicht freigegeben werden: ' + e.message);
    else if (!data?.length) setError('Platz nicht freigegeben: Datensatz nicht gefunden oder keine Berechtigung.');
    else {
      setMessage(`${source.kennzeichen || 'Radsatz'}: Lagerplatz ${source.lagerplatz} freigegeben. Karte und Schein bleiben erhalten.`);
      setSelected(null);
      setRows(previous => previous.map(r => r.id === id ? { ...r, lagerplatz: '' } : r));
    }
    setWorking(false);
  }

  function onReleaseDragOver(event: DragEvent<HTMLDivElement>) {
    if (!dragged || working) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setReleaseHover(true);
  }

  function onReleaseDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || dragged;
    setReleaseHover(false); setDragged(null); setHovered(null);
    if (id) void releasePlace(id);
  }

  async function deleteSet(r: Schein) {
    if (working) return;
    if (!window.confirm(`Radsatz ${r.kennzeichen || r.belegnummer || r.id} und zugehörigen Einlagerungsschein endgültig löschen? Der Lagerplatz wird frei.`)) return;
    setWorking(true); setError(''); setMessage('');
    const { data, error: e } = await supabase.from('reifenlager_scheine').delete().eq('id', r.id).select('id');
    if (e) setError('Radsatz löschen: ' + e.message);
    else if (!data?.length) setError('Radsatz konnte nicht gelöscht werden. Bitte Berechtigungen in Supabase prüfen.');
    else { setMessage('Radsatz gelöscht. Lagerplatz ist wieder frei.'); setSelected(null); }
    await refresh();
    setWorking(false);
  }

  function onDragStart(event: DragEvent<HTMLElement>, r: Schein) {
    if (working) { event.preventDefault(); return; }
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', r.id);
    setDragged(r.id);
    setError('');
  }
  function autoScrollWhileDragging(event: DragEvent<HTMLElement>) {
    if (!dragged || working) return;
    const edge = 100;
    const speed = 32;
    if (event.clientY < edge) window.scrollBy(0, -speed);
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, speed);
  }

  function onDragEnd() { setDragged(null); setHovered(null); setReleaseHover(false); }
  function onDragOver(event: DragEvent<HTMLButtonElement>, place: string) {
    if (!dragged || working || at(place).some(r => r.id !== dragged)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    if (hovered !== place) setHovered(place);
  }
  function onDrop(event: DragEvent<HTMLButtonElement>, place: string) {
    event.preventDefault();
    const id = event.dataTransfer.getData('text/plain') || dragged;
    setHovered(null); setDragged(null);
    if (!id) return;
    void moveTo(id, place);
  }

  function findCardForPlace(place: string) {
    const matches = at(place);
    if (!matches.length) return;
    setSelected(place);
    setQuery('');
    setExcelArea('all');
    setExcelRow('all');
    setOnlyUnassigned(false);
    setHighlightedId(matches[0].id);
  }

  function slot(place: string, label?: string) {
    const here = at(place);
    const count = here.length;
    const blocked = count > 0 && here.some(r => r.id !== dragged);
    const active = selected === place;
    return <button key={place} type="button" draggable={count === 1 && !working} onDragStart={event => { if (count === 1) onDragStart(event, here[0]); }} onDragEnd={onDragEnd} onClick={() => setSelected(place)} onDoubleClick={() => findCardForPlace(place)}
      onDragOver={event => onDragOver(event, place)} onDragLeave={() => setHovered(old => old === place ? null : old)} onDrop={event => onDrop(event, place)}
      title={`${place}: ${count ? 'Doppelklick: Radsatzkarte unten finden · Drag & Drop zum Verschieben' : 'Frei — Radsatz hierher ziehen'}`}
      style={{ width: '100%', border: hovered === place ? '3px dashed #2563eb' : active ? '3px solid #12365a' : '1px solid #cbd5e1', borderRadius: 8, padding: '8px 3px', background: count > 1 ? '#fed7aa' : count ? '#fecaca' : hovered === place ? '#bfdbfe' : '#dcfce7', color: '#172b4d', cursor: blocked ? 'not-allowed' : 'pointer', fontWeight: 700, fontSize: 12, minHeight: 42 }}>
      <span style={{ display: 'block' }}>{label ?? place}</span>
      <small>{count > 1 ? `${count} Einträge!` : count ? (here[0].kennzeichen || 'Belegt') : 'Frei'}</small>
    </button>;
  }

  const assignRow = rows.find(r => r.id === assignId);
  const assignPlaces = assignArea === 'Zelt' ? rackPlaces : warehousePlaces;
  const freeAssignPlaces = assignPlaces.filter(p => !at(p, assignArea).some(r => r.id !== assignId));
  const quickFreePlaces = (quickArea === 'Zelt' ? rackPlaces : warehousePlaces).filter(p => at(p, quickArea).length === 0);

  function card(r: Schein) {
    const isPlaced = r.lagerplatz?.trim() && (norm(r.lager) === 'ZELT' ? rackPlaces : warehousePlaces).some(p => norm(p) === norm(r.lagerplatz));
    return <article key={r.id} id={`radsatz-card-${r.id}`} draggable={!working} onDragStart={e => onDragStart(e, r)} onDragEnd={onDragEnd}
      style={{ background: highlightedId === r.id ? '#dbeafe' : '#fff', border: highlightedId === r.id ? '3px solid #2563eb' : '1px solid #dbe3ee', boxShadow: highlightedId === r.id ? '0 0 0 5px rgba(37,99,235,0.18)' : 'none', transition: 'background-color 250ms ease, border-color 250ms ease, box-shadow 250ms ease', borderRadius: 12, padding: 14, marginBottom: 10, cursor: working ? 'wait' : 'grab', opacity: dragged === r.id ? 0.5 : 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <strong style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><GripVertical size={17} color="#64748b" />{r.kennzeichen || 'Ohne Kennzeichen'}</strong>
        <span style={{ fontSize: 12, color: isPlaced ? '#991b1b' : '#92400e' }}><MapPin size={13} style={{ verticalAlign: 'middle' }} /> {isPlaced ? `${r.lager} · ${r.lagerplatz}` : 'Nicht zugeordnet'}</span>
      </div>
      {(oldArea(r) || oldPlace(r)) && <p style={{ margin: '7px 0', fontSize: 12, color: '#1d4ed8', fontWeight: 700 }}>
        Excel (alter Standort): {oldArea(r) || '—'}{oldPlace(r) ? ` · ${oldPlace(r)}` : ''}
      </p>}
      {r.daten?.schnellaufnahme === true && <p style={{ color: '#92400e', fontWeight: 700, fontSize: 12, margin: '6px 0' }}>Schnellaufnahme · Unvollständig</p>}
      <p style={{ margin: '8px 0', fontSize: 13 }}>Beleg: {r.belegnummer || '—'} · {field(r, 'fahrzeug') || 'Fahrzeug unbekannt'} · {field(r, 'saison') || '—'}</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <a href={qrUrl(r.id)} style={{ ...btn, padding: '7px 9px', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12 }}><FileText size={15} /> Schein / QR</a>
        <button type="button" style={{ ...btn, padding: '7px 9px', fontSize: 12 }} onClick={() => { setLager(norm(r.lager) === 'LAGER' ? 'Lager' : 'Zelt'); setSelected(r.lagerplatz); document.getElementById('lager-map')?.scrollIntoView({ behavior: 'smooth' }); }}>Platz anzeigen</button>
        <button type="button" disabled={working} style={{ ...btn, padding: '7px 9px', fontSize: 12, color: '#1d4ed8' }} onClick={() => { const area: Area = norm(r.lager) === 'LAGER' ? 'Lager' : 'Zelt'; setAssignId(r.id); setAssignArea(area); setAssignPlace(''); setError(''); }}>Platz zuweisen</button>
        {r.lagerplatz?.trim() && <button type="button" disabled={working} style={{ ...btn, padding: '7px 9px', color: '#166534', fontSize: 12 }} onClick={() => void releasePlace(r.id)}>Platz freigeben</button>}
        <button type="button" disabled={working} style={{ ...btn, padding: '7px 9px', color: '#b91c1c', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 5 }} onClick={() => void deleteSet(r)}><Trash2 size={14} /> Löschen</button>
      </div>
    </article>;
  }

  if (!standortId || !standortName.trim()) {
    return <section style={{ maxWidth: 1300 }}><h1>Lagerplan</h1><p>Standort wird geladen...</p></section>;
  }
  if (!isLegacyGlauchau) {
    return <StandortLagerEinrichtung key={standortId} standortId={standortId} standortName={standortName} />;
  }
  if (loadError) {
    return <section style={{ maxWidth: 1300 }}>
      <h1>Lagerplan · {standortName}</h1>
      <p role="alert" style={{ color: '#b91c1c' }}>Lagerplan aus Sicherheitsgründen gesperrt: {loadError}</p>
      <button type="button" style={btn} onClick={() => void refresh()}>Erneut versuchen</button>
    </section>;
  }
  if (busy || loadedStandortId !== standortId) {
    return <section style={{ maxWidth: 1300 }}><h1>Lagerplan · {standortName}</h1><p>Lagerdaten werden geladen...</p></section>;
  }

  return <section style={{ maxWidth: 1300 }} onDragOver={autoScrollWhileDragging}>
    <h1>{view === 'Lagerplan' ? 'Lagerplan' : 'Radsätze'} · {standortName}</h1>
    <p style={{ color: '#64748b' }}>Radsätze per Drag & Drop einlagern und wieder herausnehmen. Belegte Plätze können nicht überschrieben werden.</p>
    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
      <label style={{ display: 'flex', gap: 8, alignItems: 'center', background: '#fff', padding: 10, borderRadius: 8, flex: '1 1 240px' }}><Search size={18} /><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Kennzeichen, Beleg, Lagerplatz..." style={{ border: 0, outline: 0, flex: 1, minWidth: 0 }} /></label>
      <button type="button" style={btn} disabled={working} onClick={() => void refresh()}><RefreshCw size={15} /> Aktualisieren</button>
    </div>
    {error && <p role="alert" style={{ color: '#b91c1c', fontWeight: 600 }}>{error}</p>}
    {message && <p role="status" style={{ color: '#166534' }}>{message}</p>}
    {busy && <p>Laden...</p>}
    <div id="lager-assign" />
    {assignRow && <div style={{ background: '#fff', border: '2px solid #2563eb', borderRadius: 12, padding: 18, margin: '16px 0' }}>
      <h2 style={{ marginTop: 0 }}>Lagerplatz zuweisen · {assignRow.kennzeichen || assignRow.belegnummer || 'Radsatz'}</h2>
      <p style={{ fontSize: 13, color: '#64748b' }}>Aktueller Platz: {assignRow.lagerplatz?.trim() ? `${assignRow.lager} / ${assignRow.lagerplatz}` : 'Nicht zugeordnet'}. Nur freie Plätze stehen zur Auswahl.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end' }}>
        <label style={{ display: 'grid', gap: 5 }}>Bereich
          <select value={assignArea} onChange={e => { setAssignArea(e.target.value as Area); setAssignPlace(''); }} style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }}>
            <option value="Zelt">Zelt</option><option value="Lager">Lager</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5 }}>Freier Lagerplatz
          <select value={assignPlace} onChange={e => setAssignPlace(e.target.value)} style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', minWidth: 180 }}>
            <option value="">Bitte auswählen</option>
            {freeAssignPlaces.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
        <button type="button" style={{ ...btn, background: '#12365a', color: '#fff' }} disabled={working || !assignPlace} onClick={() => { if (assignId && assignPlace) void moveTo(assignId, assignPlace, assignArea); }}>Speichern</button>
        <button type="button" style={btn} onClick={() => { setAssignId(null); setAssignPlace(''); }}>Abbrechen</button>
      </div>
      {!freeAssignPlaces.length && <p style={{ color: '#b91c1c' }}>Keine freien Lagerplätze in diesem Bereich.</p>}
    </div>}
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginTop: 16, marginBottom: 16 }}>
      <button type="button" style={{ ...btn, background: quickOpen ? '#e2e8f0' : '#12365a', color: quickOpen ? '#12365a' : '#fff', display: 'inline-flex', alignItems: 'center', gap: 7 }} onClick={() => setQuickOpen(v => !v)}><ClipboardPlus size={18} /> + Schnellaufnahme</button>
      {quickOpen && <div style={{ marginTop: 14 }}>
        <h2 style={{ margin: '0 0 8px' }}>Radsatz schnell erfassen</h2>
        <p style={{ fontSize: 13, color: '#64748b' }}>Für gefundene Radsätze ohne vollständigen Einlagerungsschein. Erst Kennzeichen prüfen, dann freien Platz wählen.</p>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          <label style={{ display: 'grid', gap: 5, fontWeight: 700, fontSize: 13 }}>Kennzeichen *
            <input value={quickPlate} maxLength={32} onChange={e => { setQuickPlate(e.target.value); setQuickCreatedId(null); }} placeholder="z. B. Z-BS 949E" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1' }} />
          </label>
          <label style={{ display: 'grid', gap: 5, fontWeight: 700, fontSize: 13 }}>Bereich
            <select value={quickArea} onChange={e => { setQuickArea(e.target.value as Area); setQuickPlace(''); }} style={{ ...btn, minWidth: 120 }}><option value="Zelt">Zelt</option><option value="Lager">Lager</option></select>
          </label>
          <label style={{ display: 'grid', gap: 5, fontWeight: 700, fontSize: 13 }}>Freier Lagerplatz *
            <select value={quickPlace} onChange={e => setQuickPlace(e.target.value)} style={{ ...btn, minWidth: 180 }}>
              <option value="">Bitte auswählen</option>
              {quickFreePlaces.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <label style={{ display: 'grid', gap: 5, fontWeight: 700, fontSize: 13 }}>Bemerkung (optional)
            <input value={quickNote} maxLength={500} onChange={e => setQuickNote(e.target.value)} placeholder="z. B. 4 Winterräder" style={{ padding: 10, borderRadius: 8, border: '1px solid #cbd5e1', minWidth: 200 }} />
          </label>
          <button type="button" disabled={working || busy || !quickPlate.trim() || !quickPlace} onClick={() => void quickAdd()} style={{ ...btn, background: '#166534', color: '#fff' }}>Speichern</button>
        </div>
        {quickCreatedId && <p style={{ color: '#166534', fontWeight: 700 }}>Gespeichert! <a href={qrUrl(quickCreatedId)}>Schein / QR öffnen</a></p>}
        <p style={{ fontSize: 12, color: '#64748b' }}>Der Eintrag erhält eine SCHNELL-Belegnummer und die Markierung „Unvollständig“. Das ist noch kein ausgefüllter Kundeneinlagerungsschein.</p>
      </div>}
    </div>
    <div style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 16, marginTop: 16, marginBottom: 16 }}>
      <h2 style={{ margin: '0 0 12px', display: 'flex', alignItems: 'center', gap: 8 }}><Printer size={20} /> Lagerliste drucken</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'end', gap: 12 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Bereich
          <select value={printArea} onChange={e => { setPrintArea(e.target.value as Area); setPrintGroup('all'); }} style={{ ...btn, minWidth: 130 }}>
            <option value="Zelt">Zelt</option><option value="Lager">Lager</option>
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>{printArea === 'Zelt' ? 'Regal' : 'Reihe'}
          <select value={printGroup} onChange={e => setPrintGroup(e.target.value)} style={{ ...btn, minWidth: 175 }}>
            <option value="all">{printArea === 'Zelt' ? 'Alle Regale' : 'Alle Reihen'}</option>
            {printGroups.map(group => <option key={group.value} value={group.value}>{group.label}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 13, fontWeight: 700, paddingBottom: 10 }}>
          <input type="checkbox" checked={printFree} onChange={e => setPrintFree(e.target.checked)} /> Freie Plätze mitdrucken
        </label>
        <button type="button" style={{ ...btn, background: '#12365a', color: '#fff', display: 'inline-flex', gap: 7, alignItems: 'center' }} disabled={busy} onClick={printList}><Printer size={16} /> Liste drucken</button>
      </div>
      <p style={{ fontSize: 12, color: '#64748b', marginBottom: 0 }}>Druckt die aktuellen Lagerplätze aus BESICO. Keine Änderungen an Radsätzen oder Inventur.</p>
    </div>
    <div id="lager-map" style={{ marginTop: 18 }}>
      <h2>Lagerplan</h2>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14 }}>{(['Zelt', 'Lager'] as const).map(x => <button key={x} type="button" style={{ ...btn, background: lager === x ? '#12365a' : '#fff', color: lager === x ? '#fff' : '#12365a' }} onClick={() => { setLager(x); setSelected(null); }}>{x}</button>)}</div>
      <p style={{ fontSize: 13, color: '#64748b' }}>Grün = frei · Rot = belegt · Orange = bestehende Doppelbelegung. Doppelklick auf einen belegten Platz findet die Karte unten. Zum Einlagern auf Grün ziehen. Zum Freigeben einen belegten Platz auf die Ablage unten ziehen oder „Platz freigeben“ wählen.</p>
      {lager === 'Zelt' ? <>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginBottom: 16 }}>
          <input aria-label="Neuer Regalname" placeholder="Regalname, z. B. 1009, 1008/2, MW/VFW" value={newRegal} onChange={e => setNewRegal(e.target.value)} style={{ padding: 10, border: '1px solid #cbd5e1', borderRadius: 8, minWidth: 290 }} />
          <button type="button" disabled={working} style={btn} onClick={() => void addRegal()}><Plus size={15} /> Regal hinzufügen</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 12 }}>
          {regale.map(n => <div key={`standard-${n}`} style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Regal {n}</strong><button type="button" title={`Regal ${n} löschen`} disabled={working} onClick={() => void deleteRegal(n)} style={{ ...btn, color: '#b91c1c', padding: 5 }}><Trash2 size={16} /></button></div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{[2, 1, 0].map(i => <div key={i}><small>{['Unten', 'Mitte', 'Oben'][i]}</small>{slot(`${n}0${i}`)}</div>)}</div>
          </div>)}
          {customPlaces.map(name => <div key={`custom-${name}`} style={{ background: '#fff', border: '1px solid #dbe3ee', borderRadius: 12, padding: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><strong>Regal {name}</strong><button type="button" title={`Regal ${name} löschen`} disabled={working} onClick={() => void deleteCustomRegal(name)} style={{ ...btn, color: '#b91c1c', padding: 5 }}><Trash2 size={16} /></button></div>
            <div style={{ display: 'grid', gap: 8, marginTop: 12 }}>{[2, 1, 0].map(i => <div key={i}><small>{['Unten', 'Mitte', 'Oben'][i]}</small>{slot(customLevels(name)[i])}</div>)}
              {legacyCustomPlaces.includes(name) && <div><small>Bisheriger Einzelplatz (belegt)</small>{slot(name)}</div>}
            </div>
          </div>)}
        </div>
      </> : <div style={{ overflowX: 'auto', background: '#fff', borderRadius: 12, padding: 12 }}><div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,minmax(116px,1fr))', gap: 9, minWidth: 740 }}>{[1, 2, 3, 4, 5, 6].map(r => <div key={r}><strong style={{ display: 'block', textAlign: 'center', marginBottom: 8 }}>Reihe {r}</strong><div style={{ display: 'grid', gap: 8 }}>{[6, 5, 4, 3, 2, 1].map(s => <div key={s} style={{ border: '1px solid #e2e8f0', padding: 4, borderRadius: 8 }}><strong style={{ display: 'block', textAlign: 'center', fontSize: 12 }}>Stapel {s}</strong>{slot(`R${r}-${s}-Oben`, 'Oben')}{slot(`R${r}-${s}-Unten`, 'Unten')}</div>)}</div></div>)}</div><div style={{ textAlign: 'center', background: '#e2e8f0', marginTop: 12, padding: 10, borderRadius: 8, fontWeight: 700 }}>EINGANG — unten · Stapel 1 unten, Stapel 6 oben</div></div>}
      {selected && <div style={{ marginTop: 18, padding: 14, background: '#fff', border: '2px solid #12365a', borderRadius: 12 }}><strong>{lager} · {selected}</strong>{selectedRows.length ? selectedRows.map(r => <p key={r.id} style={{ margin: '8px 0' }}>{r.kennzeichen || 'Ohne Kennzeichen'} · {r.belegnummer || '—'} — Belegt. <button type="button" disabled={working} style={{ ...btn, marginLeft: 8 }} onClick={() => void releasePlace(r.id)}>Platz freigeben</button></p>) : <p>Frei — Radsatz aus der Liste unten hierher ziehen.</p>}</div>}
    </div>
    <div id="radsaetze-unten" style={{ marginTop: 28, paddingTop: 12, borderTop: '2px solid #cbd5e1' }}>
      <div onDragOver={onReleaseDragOver} onDragLeave={() => setReleaseHover(false)} onDrop={onReleaseDrop}
        style={{ padding: 18, marginBottom: 16, border: `3px dashed ${releaseHover ? '#2563eb' : '#94a3b8'}`, borderRadius: 12, background: releaseHover ? '#dbeafe' : '#f1f5f9', textAlign: 'center', fontWeight: 700, color: '#12365a' }}>
        ↙ HIER ABLEGEN — Lagerplatz freigeben (Karte und Schein bleiben erhalten)
      </div>
      <h2>Radsätze — unten</h2>
      <p style={{ color: '#64748b', fontSize: 13 }}>Alle gespeicherten Radsätze ({rows.length}). Mit der Maus ziehen und auf eine grüne Zelle legen. Ein belegter Platz kann nicht überschrieben werden. Zum Herausnehmen die Karte auf „HIER ABLEGEN“ ziehen oder „Platz freigeben“ klicken.</p>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'end', background: '#fff', border: '1px solid #dbe3ee', borderRadius: 10, padding: 12, marginBottom: 12 }}>
        <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Bereich aus Excel
          <select aria-label="Bereich aus Excel" value={excelArea} onChange={e => { setExcelArea(e.target.value); setExcelRow('all'); }} style={{ ...btn, minWidth: 170 }}>
            <option value="all">Alle Bereiche</option>
            {excelAreas.map(area => <option key={area} value={area}>{area}</option>)}
          </select>
        </label>
        <label style={{ display: 'grid', gap: 5, fontSize: 13, fontWeight: 700 }}>Alter Lagerplatz (Excel)
          <select aria-label="Alter Lagerplatz (Excel)" value={excelRow} onChange={e => setExcelRow(e.target.value)} style={{ ...btn, minWidth: 145 }}>
            <option value="all">Alle alten Plätze</option>
            {excelLocations.map(platz => <option key={platz} value={platz}>{platz}</option>)}
          </select>
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 700, paddingBottom: 10 }}>
          <input type="checkbox" checked={onlyUnassigned} onChange={e => setOnlyUnassigned(e.target.checked)} /> Nur ohne neuen Lagerplatz
        </label>
        <button type="button" style={btn} onClick={() => { setExcelArea('all'); setExcelRow('all'); setOnlyUnassigned(false); setQuery(''); }}>Filter zurücksetzen</button>
        <span style={{ fontSize: 13, color: '#475569', paddingBottom: 10 }}>{filtered.length} von {rows.length} Radsätzen</span>
      </div>
      {!rows.some(r => oldArea(r) || oldPlace(r)) && !busy && <p style={{ color: '#92400e', fontSize: 13 }}>Keine alten Excel-Lagerplätze in den gespeicherten Datensätzen gefunden. Bitte Importdaten prüfen.</p>}
      {!busy && (filtered.length ? <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 10 }}>{filtered.map(card)}</div> : <p>Keine Radsätze für diesen Filter gefunden.</p>)}
      {activeDrag && <p style={{ color: '#1d4ed8' }}>Verschieben: {activeDrag.kennzeichen} → {lager}</p>}
    </div>
  </section>;
}