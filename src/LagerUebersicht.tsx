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
