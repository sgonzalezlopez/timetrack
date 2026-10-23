/* global bootstrap, core, recordsExcelText */
(function () {
    let folder, busy = false
    const text = key => recordsExcelText[key] || key
    async function writeFile(handle, contents) {
        const writer = await handle.createWritable()
        try {
            await writer.write(contents)
            await writer.close()
        } catch (err) {
            try { await writer.abort() }
            catch (abortError) { console.error('Records Excel writer cleanup:', abortError) }
            throw err
        }
    }
    function message(value, success = false) {
        const element = $('#RecordsExcel_message').text(value).prop('hidden', false)
            .toggleClass('alert-success', success).toggleClass('alert-danger', !success)
        element[0].focus()
    }
    function setBusy(value) {
        busy = value
        $('#RecordsExcelModal button, #RecordsExcel_file').prop('disabled', value)
        $('#RecordsExcel_save').prop('disabled', value || !folder || !$('#RecordsExcel_file').val())
    }
    $(document).on('click', '#RecordsExcel_open', function () {
        if (busy) return
        folder = null
        $('#RecordsExcel_file').empty()
        $('#RecordsExcel_message').prop('hidden', true)
        setBusy(false)
        bootstrap.Modal.getOrCreateInstance(document.getElementById('RecordsExcelModal')).show()
        if (!window.showDirectoryPicker) message(text('RECORDS_EXCEL_UNSUPPORTED'))
    })
    $(document).on('click', '#RecordsExcel_folder', async function () {
        if (busy) return
        if (!window.showDirectoryPicker) return message(text('RECORDS_EXCEL_UNSUPPORTED'))
        try {
            folder = await window.showDirectoryPicker({ mode: 'readwrite' })
            setBusy(true)
            const names = []
            for await (const entry of folder.values()) {
                if (entry.kind === 'file' && /\.xlsx$/i.test(entry.name) && !entry.name.startsWith('~$')) names.push(entry.name)
            }
            $('#RecordsExcel_file').empty()
            for (const name of names.sort()) $('#RecordsExcel_file').append($('<option>').val(name).text(name))
            if (!names.length) message(text('RECORDS_EXCEL_NO_FILES'))
            else $('#RecordsExcel_message').prop('hidden', true)
        } catch (err) {
            if (err.name !== 'AbortError') message(`${text('RECORDS_EXCEL_ERROR')} ${err.message}`)
        } finally { setBusy(false) }
    })
    $(document).on('change', '#RecordsExcel_file', () => setBusy(false))
    $(document).on('click', '#RecordsExcel_save', async function () {
        if (busy || !folder) return
        const name = $('#RecordsExcel_file').val()
        if (!name || !window.confirm(`${text('RECORDS_EXCEL_CONFIRM')}\n${name}`)) return
        setBusy(true)
        let backupName
        try {
            const handle = await folder.getFileHandle(name)
            const original = await handle.getFile()
            const data = new FormData()
            data.set('file', original, name)
            data.set('filters', JSON.stringify(core.forms.parse('RecordsForm')))
            const response = await fetch('/api/registry/records/excel', { method: 'POST', body: data })
            if (!response.ok) {
                const error = await response.json()
                throw new Error(error.message || text('RECORDS_EXCEL_ERROR'))
            }
            const updated = await response.blob()
            const latest = await handle.getFile()
            if (latest.lastModified !== original.lastModified || latest.size !== original.size) {
                throw new Error(text('RECORDS_EXCEL_CHANGED'))
            }
            const candidate = name.replace(/\.xlsx$/i, '') + `.backup-${new Date().toISOString().replace(/[:.]/g, '-')}-${crypto.randomUUID()}.xlsx`
            const backup = await folder.getFileHandle(candidate, { create: true })
            await writeFile(backup, original)
            backupName = candidate
            const beforeWrite = await handle.getFile()
            if (beforeWrite.lastModified !== original.lastModified || beforeWrite.size !== original.size) {
                throw new Error(text('RECORDS_EXCEL_CHANGED'))
            }
            await writeFile(handle, updated)
            message(`${text('RECORDS_EXCEL_SAVED')} ${response.headers.get('X-Records-Count')} / ` +
                `${response.headers.get('X-Records-Groups')}\n${name}\n${text('RECORDS_EXCEL_BACKUP')} ${backupName}`, true)
        } catch (err) {
            message(`${text('RECORDS_EXCEL_ERROR')} ${err.message}${backupName ? `\n${text('RECORDS_EXCEL_BACKUP')} ${backupName}` : ''}`)
        } finally { setBusy(false) }
    })
    $(document).on('hide.bs.modal', '#RecordsExcelModal', event => { if (busy) event.preventDefault() })
}())
