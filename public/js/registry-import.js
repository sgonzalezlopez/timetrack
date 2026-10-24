/* global bootstrap, registryImportText */
(function () {
    const text = key => registryImportText[key] || key;
    let preview = null;
    let busy = false;
    let competitionId = null;
    let importBase = null;
    const trackSelectors = new Map();
    const duplicateSelectors = new Map();
    const rowSelectors = [];
    const modal = () => bootstrap.Modal.getOrCreateInstance(document.getElementById('RegistryImportModal'));
    function reveal(element) {
        element[0].scrollIntoView({ block: 'center' });
        element[0].focus({ preventScroll: true });
    }
    function showError(message) {
        const alert = $('#RegistryImportError').text(message).prop('hidden', false);
        reveal(alert);
    }
    function setBusy(value) {
        busy = value;
        $('#RegistryImportForm :input, #RegistryImportCommit, #RegistryImportDuplicates select').prop('disabled', value);
        $('#RegistryImportRows :input, #RegistryImportTracks select').prop('disabled', value);
        $('#RegistryImportUpdateCategories').prop('disabled', value);
        $('#RegistryImportClub').prop('disabled', value || !$('#RegistryImportClubOnly').prop('checked'));
        if (!value) for (const controls of rowSelectors) {
            if (controls.skaterLocked) controls.skaters.prop('disabled', true);
            if (controls.categoryLocked) controls.category.prop('disabled', true);
        }
        $('#RegistryImportModal [data-bs-dismiss]').prop('disabled', value);
    }
    function request(url, data, multipart) {
        return $.ajax({
            type: 'POST', url, data: multipart ? data : JSON.stringify(data),
            processData: !multipart, contentType: multipart ? false : 'application/json', dataType: 'json'
        });
    }
    function select(options, label) {
        const control = $('<select class="form-select form-select-sm">').attr('aria-label', label);
        for (const [value, name] of options) control.append($('<option>').val(value).text(name));
        return control;
    }
    function reviewDuplicates(conflicts) {
        const panel = $('#RegistryImportDuplicates').prop('hidden', false);
        if (!duplicateSelectors.size) panel.empty().append($('<h6>').text(text('IMPORT_DUPLICATE_REVIEW')));
        for (const conflict of conflicts) {
            if (duplicateSelectors.has(conflict.index)) duplicateSelectors.get(conflict.index).section.remove();
            const section = $('<div class="mb-3">').append($('<strong>').text(
                `${conflict.row}: ${conflict.incoming.name} · ${conflict.eventName || ''}`));
            if (conflict.hidden) section.append($('<p>').text(text('IMPORT_DUPLICATE_HIDDEN')));
            const table = $('<table class="table table-sm table-bordered">');
            const header = $('<tr>').append($('<th>'), $('<th>').text(text('IMPORT_INCOMING')));
            for (const existing of conflict.existing) header.append($('<th>').text(
                existing.fromFile ? `${text('IMPORT_IN_FILE')} ${existing.row}` : `${text('IMPORT_EXISTING')} (${existing.id})`));
            table.append($('<thead>').append(header));
            const body = $('<tbody>');
            for (const [field, label] of [
                ['name', 'MODEL_Skater'], ['clubName', 'COL_club'],
                ['date', 'IMPORT_DATE'], ['race', 'COL_race'], ['distance', 'COL_distance'],
                ['totalTime', 'COL_totalTime'], ['times', 'IMPORT_SPLITS'], ['category', 'COL_category'],
                ['rail', 'COL_rail'], ['starting', 'COL_starting'], ['source', 'IMPORT_SOURCE'],
                ['externalReference', 'IMPORT_REFERENCE']
            ]) {
                const tr = $('<tr>').append($('<th>').text(text(label)));
                for (const record of [conflict.incoming, ...conflict.existing]) {
                    let value = record[field];
                    if (field === 'date' && value) value = value.slice(0, 10);
                    if (field === 'times') value = (value || []).join(', ');
                    if ((field === 'times' || field === 'totalTime') && value != null && value !== '') value = `${value} ms`;
                    tr.append($('<td>').text(value == null ? '' : String(value)));
                }
                body.append(tr);
            }
            section.append($('<div class="table-responsive">').append(table.append(body)));
            const action = select([['', text('IMPORT_SELECT')], ['skip', text('IMPORT_SKIP')],
                ...(conflict.replaceable.length ? [['replace', text('IMPORT_REPLACE')]] : []),
                ...(conflict.canKeep ? [['keep', text('IMPORT_KEEP_DISTINCT')]] : [])], text('IMPORT_DUPLICATE_DECISION'));
            const existing = select(conflict.replaceable.map(id => [id, id]), text('IMPORT_EXISTING')).prop('hidden', true);
            action.on('change', () => existing.prop('hidden', action.val() !== 'replace'));
            duplicateSelectors.set(conflict.index, { action, existing, token: conflict.token, section });
            panel.append(section.append(action, existing));
        }
        reveal(panel);
    }
    function review(result) {
        preview = result;
        trackSelectors.clear();
        duplicateSelectors.clear();
        $('#RegistryImportDuplicates').prop('hidden', true);
        rowSelectors.length = 0;
        $('#RegistryImportRows, #RegistryImportTracks').empty();
        for (const row of result.rows) {
            if (row.destination && row.destination.needsTrack && !row.issue && !trackSelectors.has(row.trackName || '')) {
                const control = select([['', text('IMPORT_SELECT')],
                    ...result.tracks.map(t => [t.id, `${t.name}${t.location ? ` (${t.location})` : ''}`])], text('IMPORT_TRACK'));
                trackSelectors.set(row.trackName || '', control);
                $('#RegistryImportTracks').append($('<label class="d-block mb-2">')
                    .text(`${text('IMPORT_TRACK')}${row.trackName ? ` (${row.trackName})` : ''}: `).append(control));
            }
            const tr = $('<tr>');
            tr.append($('<td>').text(row.sourceLocation || row.index + 2), $('<td>').text(`${row.skaterName} (${row.gender})`));
            const raceCell = $('<td>').text(row.race);
            const requiredInputs = row.requiredInputs || [];
            let date, distance;
            if (!row.issue && requiredInputs.includes('date') && !row.date) {
                date = $('<input type="date" class="form-control form-control-sm">')
                    .attr('aria-label', text('IMPORT_DATE'));
                raceCell.append($('<label class="d-block mt-2">').text(text('IMPORT_DATE')).append(date));
                if (row.dateText) raceCell.append($('<small>').text(row.dateText));
            }
            if (!row.issue && requiredInputs.includes('distance') && row.distance == null) {
                distance = $('<input type="number" min="0.001" step="any" class="form-control form-control-sm">')
                    .attr('aria-label', text('IMPORT_DISTANCE'));
                raceCell.append($('<label class="d-block mt-2">').text(text('IMPORT_DISTANCE')).append(distance));
            }
            if (row.destination) {
                const destination = row.destination;
                const description = $('<small class="d-block">');
                const updateDestination = () => {
                    const control = trackSelectors.get(row.trackName || '');
                    const selected = control && result.tracks.find(t => t.id === control.val());
                    const trackName = selected ? selected.name : destination.trackName || text('IMPORT_SELECT');
                    let season = destination.season;
                    if (date && date.val()) {
                        const value = new Date(date.val());
                        if (Number.isFinite(value.getTime())) {
                            const year = value.getUTCFullYear();
                            const start = result.seasonStartMonth;
                            const first = value.getUTCMonth() + 1 < start ? year - 1 : year;
                            season = start === 1 ? String(year) : `${first}-${first + 1}`;
                        }
                    }
                    description.text(`${row.competitionName || ''} · ${trackName} · ${season || text('IMPORT_SEASON_PENDING')}`);
                };
                const control = trackSelectors.get(row.trackName || '');
                if (control) control.on('change', updateDestination);
                if (date) date.on('change', updateDestination);
                updateDestination();
                raceCell.append(description);
                if (!destination.issue && !date) raceCell.append($('<small class="d-block">').text(
                    `${text(destination.createEvent ? 'IMPORT_EVENT_NEW' : 'IMPORT_EVENT_EXISTING')}: ${destination.name}` +
                    (destination.createTrack ? ` · ${text('IMPORT_TRACK_NEW')}` : '')));
            }
            tr.append(raceCell);
            const actionOptions = [['skip', text('IMPORT_SKIP')]];
            if (!row.issue) {
                if (!row.duplicate || row.duplicateId) actionOptions.push(['import', text('IMPORT_SAVE')]);
                if (row.duplicateId) actionOptions.push(['replace', text('IMPORT_REPLACE')]);
            }
            const action = select(actionOptions, text('IMPORT_SAVE'));
            if (!row.issue && (!row.duplicate || row.duplicateId) &&
                (row.automaticSkater || !row.candidates.length && result.createSkaters)) action.val('import');
            const skaters = select([['', text('IMPORT_SELECT')],
                ...row.candidates.map(c => [c.id, `${c.name} | ${c.birthDate ? c.birthDate.slice(0, 10) : '—'} | ${c.category || '—'}`]),
                ...(result.createSkaters ? [['new', text('IMPORT_NEW')]] : [])], row.skaterName);
            if (row.automaticSkater) skaters.val(row.automaticSkater).prop('disabled', true);
            else if (!row.issue && !row.candidates.length && result.createSkaters) skaters.val('new');
            const category = select([['', text('IMPORT_SELECT')], ...result.categories.map(c => [c, c])], text('COL_category'));
            const currentCategory = $('<small class="d-block">');
            const controls = { action, skaters, date, distance, category, skaterLocked: !!row.automaticSkater };
            const selectedSkater = () => row.candidates.find(c => c.id === skaters.val());
            const updateDifference = () => {
                const skater = selectedSkater();
                currentCategory.text(skater ? `${text('IMPORT_CATEGORY_CURRENT')}: ${skater.category || '—'}` : '');
            };
            const updateCategorySource = () => {
                const skater = selectedSkater();
                const inherited = result.categorySource === 'database' && skaters.val() !== 'new' ?
                    skater && skater.category : row.category;
                controls.categoryLocked = result.categories.includes(inherited);
                category.val(controls.categoryLocked ? inherited : '').prop('disabled', controls.categoryLocked);
                updateDifference();
            };
            skaters.on('change', updateCategorySource);
            category.on('change', updateDifference);
            updateCategorySource();
            tr.append($('<td>').append(
                $('<small class="d-block">').text(`${row.inputCategory || '—'}`), currentCategory, category));
            const messages = [...row.warnings];
            if (row.issue) messages.push(row.issue);
            if (row.duplicate) messages.push('IMPORT_DUPLICATE');
            if (row.competitionMismatch) messages.push('IMPORT_COMPETITION_MISMATCH');
            tr.append($('<td>').append(action, skaters),
                $('<td>').text(messages.map(text).join(' · ')));
            rowSelectors.push(controls);
            $('#RegistryImportRows').append(tr);
        }
        $('#RegistryImportReview').prop('hidden', false);
    }
    $(document).on('click', '#RegistryImport_open', async function () {
        if (busy) return;
        const registryScope = $(this).attr('data-import-scope') === 'registry';
        competitionId = registryScope ? null : $('#CompetitionForm #id').val();
        if (!registryScope && !competitionId) return;
        importBase = registryScope ? '/api/registry' : `/api/competition/${competitionId}`;
        preview = null;
        duplicateSelectors.clear();
        $('#RegistryImportDuplicates').prop('hidden', true);
        $('#RegistryImportForm')[0].reset();
        $('#RegistryImportUpdateCategories').val('');
        $('#RegistryImportReview, #RegistryImportReport, #RegistryImportError').prop('hidden', true);
        $('#RegistryImportFormat').empty();
        $('#RegistryImportClub').empty();
        modal().show();
        setBusy(true);
        try {
            const base = registryScope ? '/api/registry' : '/api/competition';
            const [formats, options] = await Promise.all([
                $.getJSON(`${base}/import-formats`), $.getJSON(`${base}/import-options`)
            ]);
            $('#RegistryImportClub').append($('<option>').val('').text(text('IMPORT_SELECT')));
            for (const club of options.clubs) $('#RegistryImportClub').append($('<option>').val(club.id).text(club.name));
            for (const format of formats) $('#RegistryImportFormat').append(
                $('<option>').val(format.id).text(format.label).attr('data-extensions', format.extensions.join(',')));
            $('#RegistryImportFormat').trigger('change');
            if (!formats.length) showError(text('IMPORT_NO_FORMATS'));
        } catch (err) { showError(err.responseJSON && err.responseJSON.message || text('IMPORT_ERROR')); }
        finally { setBusy(false); }
    });
    $(document).on('change', '#RegistryImportFormat', function () {
        $('#RegistryImportFile').attr('accept', $(this).find(':selected').attr('data-extensions') || '');
    });
    $(document).on('change', '#RegistryImportCategorySource, #RegistryImportClubOnly, #RegistryImportClub, #RegistryImportCreate, #RegistryImportFormat, #RegistryImportFile', function () {
        if (busy) return;
        preview = null;
        $('#RegistryImportReview, #RegistryImportReport, #RegistryImportError').prop('hidden', true);
        $('#RegistryImportClub').prop('disabled', !$('#RegistryImportClubOnly').prop('checked'));
    });
    $(document).on('submit', '#RegistryImportForm', async function (event) {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(this);
        data.set('createSkaters', String($('#RegistryImportCreate').prop('checked')));
        if ($('#RegistryImportClubOnly').prop('checked') && !$('#RegistryImportClub').val()) {
            showError(text('IMPORT_CLUB_CHOOSE'));
            return;
        }
        data.set('clubId', $('#RegistryImportClubOnly').prop('checked') ? $('#RegistryImportClub').val() : '');
        $('#RegistryImportError, #RegistryImportReview, #RegistryImportReport').prop('hidden', true);
        setBusy(true);
        try { review(await request(`${importBase}/import/preview`, data, true)); }
        catch (err) { showError(err.responseJSON && err.responseJSON.message || text('IMPORT_ERROR')); }
        finally { setBusy(false); }
    });
    $(document).on('click', '#RegistryImportCommit', async function () {
        if (busy || !preview) return;
        $('#RegistryImportError').prop('hidden', true);
        const choices = preview.rows.map((row, i) => ({
            action: rowSelectors[i].action.val(), skaterId: rowSelectors[i].skaters.val(),
            category: rowSelectors[i].category.val(),
            updateSkaterCategory: $('#RegistryImportUpdateCategories').val() === 'yes' ? true :
                $('#RegistryImportUpdateCategories').val() === 'no' ? false : undefined,
            date: rowSelectors[i].date && rowSelectors[i].date.val(),
            distance: rowSelectors[i].distance && rowSelectors[i].distance.val(),
            trackId: trackSelectors.get(row.trackName || '') && trackSelectors.get(row.trackName || '').val(),
            duplicateAction: duplicateSelectors.get(i) && duplicateSelectors.get(i).action.val(),
            duplicateId: duplicateSelectors.get(i) && duplicateSelectors.get(i).existing.val(),
            duplicateReviewToken: duplicateSelectors.get(i) && duplicateSelectors.get(i).token
        }));
        if (choices.some((c, i) => c.action !== 'skip' && duplicateSelectors.has(i) && !c.duplicateAction)) {
            showError(text('IMPORT_DUPLICATE_DECISION'));
            return;
        }
        if (choices.some((c, i) => c.action !== 'skip' && !preview.rows[i].issue &&
            preview.rows[i].destination && preview.rows[i].destination.needsTrack && !c.trackId)) {
            showError(text('IMPORT_CHOOSE_TRACK'));
            return;
        }
        const incomplete = choices.findIndex((c, i) =>
            c.action !== 'skip' && !preview.rows[i].issue && (!c.skaterId || !c.category));
        if (incomplete !== -1) {
            const row = preview.rows[incomplete];
            showError(`${text('IMPORT_CHOOSE')} (${row.sourceLocation || row.index + 2}: ${row.skaterName})`);
            const control = !choices[incomplete].category ?
                rowSelectors[incomplete].category : rowSelectors[incomplete].skaters;
            control.attr('aria-invalid', 'true');
            return;
        }
        if (!choices.some(c => c.action !== 'skip')) {
            showError(text('IMPORT_NOTHING_SELECTED'));
            return;
        }
        const undecided = choices.findIndex((c, i) => {
            const skater = preview.rows[i].candidates.find(s => s.id === c.skaterId);
            return c.action !== 'skip' && skater && skater.category !== c.category && c.updateSkaterCategory === undefined;
        });
        if (undecided !== -1) {
            showError(text('IMPORT_CATEGORY_UPDATE_CHOOSE'));
            $('#RegistryImportUpdateCategories').attr('aria-invalid', 'true');
            return;
        }
        if (choices.some((c, i) => c.action !== 'skip' && !preview.rows[i].issue &&
            (rowSelectors[i].date && !c.date ||
                rowSelectors[i].distance && (!c.distance || !Number.isFinite(Number(c.distance)) || Number(c.distance) <= 0)))) {
            showError(text('IMPORT_MISSING_FIELDS'));
            return;
        }
        setBusy(true);
        try {
            const report = await request(`${importBase}/import/commit`, { token: preview.token, choices });
            const output = $('#RegistryImportReport').empty().prop('hidden', false);
            for (const [key, label] of [
                ['imported', 'IMPORT_IMPORTED'], ['skipped', 'IMPORT_OMITTED'],
                ['failed', 'IMPORT_FAILED'], ['createdSkaters', 'IMPORT_CREATED'],
                ...(report.updatedSkaters ? [['updatedSkaters', 'IMPORT_UPDATED_SKATERS']] : []),
                ...(report.createdEvents ? [['createdEvents', 'IMPORT_CREATED_EVENTS'], ['createdTracks', 'IMPORT_CREATED_TRACKS']] : [])
            ]) {
                const details = $('<details>').append($('<summary>').text(`${text(label)}: ${report[key].length}`));
                const list = $('<ul>');
                for (const row of report[key]) {
                    const notes = [...(row.warnings || [])];
                    if (row.reason) notes.push(row.reason);
                    if (row.categorySubstituted) notes.push('IMPORT_CATEGORY_SUBSTITUTED');
                    list.append($('<li>').text(`${row.row}: ${row.name}${row.category ? ` → ${row.category}` : ''}` +
                        `${row.season ? ` (${row.season})` : ''} ${notes.map(text).join(' · ')}`));
                }
                output.append(details.append(list));
            }
            preview = null;
            $('#RegistryImportReview').prop('hidden', true);
            reveal(output);
            if (!competitionId) $('#RegistryForm_search_btn').trigger('click');
        } catch (err) {
            if (err.responseJSON && err.responseJSON.code === 'IMPORT_DUPLICATE_REVIEW') reviewDuplicates(err.responseJSON.conflicts);
            else showError(err.responseJSON && err.responseJSON.message || text('IMPORT_ERROR'));
        }
        finally { setBusy(false); }
    });
    $(document).on('hide.bs.modal', '#RegistryImportModal', function (event) {
        if (busy) event.preventDefault();
    });
}());
