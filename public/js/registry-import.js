/* global bootstrap, registryImportText */
(function () {
    const text = key => registryImportText[key] || key;
    let preview = null;
    let busy = false;
    let competitionId = null;
    const categorySelectors = new Map();
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
        $('#RegistryImportForm :input, #RegistryImportCommit').prop('disabled', value);
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
    function review(result) {
        preview = result;
        categorySelectors.clear();
        rowSelectors.length = 0;
        $('#RegistryImportCategories, #RegistryImportRows').empty();
        for (const row of result.rows) {
            if (!row.category && !row.issue && !categorySelectors.has(row.inputCategory)) {
                const control = select([['', text('IMPORT_SELECT')], ...result.categories.map(c => [c, c])], row.inputCategory);
                categorySelectors.set(row.inputCategory, control);
                $('#RegistryImportCategories').append(
                    $('<label class="d-block mb-2">').text(`${row.inputCategory || '—'}: `).append(control));
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
            tr.append(raceCell);
            const actionOptions = [['skip', text('IMPORT_SKIP')]];
            if (!row.issue) {
                if (!row.duplicate) actionOptions.push(['import', text('IMPORT_SAVE')]);
                else if (row.duplicateId) actionOptions.push(['replace', text('IMPORT_REPLACE')]);
            }
            const action = select(actionOptions, text('IMPORT_SAVE'));
            if (!row.issue && !row.duplicate && (row.automaticSkater || !row.candidates.length && result.createSkaters)) action.val('import');
            const skaters = select([['', text('IMPORT_SELECT')],
                ...row.candidates.map(c => [c.id, `${c.name} | ${c.birthDate ? c.birthDate.slice(0, 10) : '—'} | ${c.category || '—'}`]),
                ...(result.createSkaters ? [['new', text('IMPORT_NEW')]] : [])], row.skaterName);
            if (row.automaticSkater) skaters.val(row.automaticSkater).prop('disabled', true);
            else if (!row.candidates.length && result.createSkaters) skaters.val('new');
            const messages = [...row.warnings];
            if (row.issue) messages.push(row.issue);
            if (row.duplicate) messages.push('IMPORT_DUPLICATE');
            if (row.competitionMismatch) messages.push('IMPORT_COMPETITION_MISMATCH');
            tr.append($('<td>').append(action, skaters),
                $('<td>').text(messages.map(text).join(' · ')));
            rowSelectors.push({ action, skaters, date, distance });
            $('#RegistryImportRows').append(tr);
        }
        $('#RegistryImportReview').prop('hidden', false);
    }
    $(document).on('click', '#RegistryImport_open', async function () {
        if (busy) return;
        competitionId = $('#CompetitionForm #id').val();
        if (!competitionId) return;
        preview = null;
        $('#RegistryImportForm')[0].reset();
        $('#RegistryImportReview, #RegistryImportReport, #RegistryImportError').prop('hidden', true);
        $('#RegistryImportFormat').empty();
        modal().show();
        setBusy(true);
        try {
            const formats = await $.getJSON('/api/competition/import-formats');
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
    $(document).on('submit', '#RegistryImportForm', async function (event) {
        event.preventDefault();
        if (busy) return;
        const data = new FormData(this);
        data.set('createSkaters', String($('#RegistryImportCreate').prop('checked')));
        $('#RegistryImportError, #RegistryImportReview, #RegistryImportReport').prop('hidden', true);
        setBusy(true);
        try { review(await request(`/api/competition/${competitionId}/import/preview`, data, true)); }
        catch (err) { showError(err.responseJSON && err.responseJSON.message || text('IMPORT_ERROR')); }
        finally { setBusy(false); }
    });
    $(document).on('click', '#RegistryImportCommit', async function () {
        if (busy || !preview) return;
        $('#RegistryImportError').prop('hidden', true);
        const choices = preview.rows.map((row, i) => ({
            action: rowSelectors[i].action.val(), skaterId: rowSelectors[i].skaters.val(),
            category: row.category || categorySelectors.get(row.inputCategory) && categorySelectors.get(row.inputCategory).val(),
            date: rowSelectors[i].date && rowSelectors[i].date.val(),
            distance: rowSelectors[i].distance && rowSelectors[i].distance.val()
        }));
        const incomplete = choices.findIndex((c, i) =>
            c.action !== 'skip' && !preview.rows[i].issue && (!c.skaterId || !c.category));
        if (incomplete !== -1) {
            const row = preview.rows[incomplete];
            showError(`${text('IMPORT_CHOOSE')} (${row.sourceLocation || row.index + 2}: ${row.skaterName})`);
            const control = !choices[incomplete].category ?
                categorySelectors.get(row.inputCategory) : rowSelectors[incomplete].skaters;
            control.attr('aria-invalid', 'true');
            return;
        }
        if (!choices.some(c => c.action !== 'skip')) {
            showError(text('IMPORT_NOTHING_SELECTED'));
            return;
        }
        if (choices.some((c, i) => c.action !== 'skip' && !preview.rows[i].issue &&
            (rowSelectors[i].date && !c.date ||
                rowSelectors[i].distance && (!c.distance || !Number.isFinite(Number(c.distance)) || Number(c.distance) <= 0)))) {
            showError(text('IMPORT_MISSING_FIELDS'));
            return;
        }
        if (choices.some(c => c.action === 'replace') && !window.confirm(text('IMPORT_CONFIRM_REPLACE'))) return;
        setBusy(true);
        try {
            const report = await request(`/api/competition/${competitionId}/import/commit`, { token: preview.token, choices });
            const output = $('#RegistryImportReport').empty().prop('hidden', false);
            for (const [key, label] of [
                ['imported', 'IMPORT_IMPORTED'], ['skipped', 'IMPORT_OMITTED'],
                ['failed', 'IMPORT_FAILED'], ['createdSkaters', 'IMPORT_CREATED']
            ]) {
                const details = $('<details>').append($('<summary>').text(`${text(label)}: ${report[key].length}`));
                const list = $('<ul>');
                for (const row of report[key]) {
                    const notes = [...(row.warnings || [])];
                    if (row.reason) notes.push(row.reason);
                    if (row.categorySubstituted) notes.push('IMPORT_CATEGORY_SUBSTITUTED');
                    list.append($('<li>').text(`${row.row}: ${row.name}${row.category ? ` → ${row.category}` : ''} ${notes.map(text).join(' · ')}`));
                }
                output.append(details.append(list));
            }
            preview = null;
            $('#RegistryImportReview').prop('hidden', true);
            reveal(output);
        } catch (err) { showError(err.responseJSON && err.responseJSON.message || text('IMPORT_ERROR')); }
        finally { setBusy(false); }
    });
    $(document).on('hide.bs.modal', '#RegistryImportModal', function (event) {
        if (busy) event.preventDefault();
    });
}());
