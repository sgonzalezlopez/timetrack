core.setOptions({ locale: 'es', appName: 'Time Tracking' })


function showDetail(index) {
   $('#table').bootstrapTable('toggleDetailView', index);

}

function registryDetailFormatter(index, row) {
    let html = `<div class="registryDetail"><div class="col-12">`;

    if (Array.isArray(row.times)) {
        row.times.forEach((time, lapIndex) => {
            html += `
                <div class="row">
                    <div class="col-1">
                        <div class="lap-label">LAP[${lapIndex}]</div>
                    </div>
                    <div class="col-11">
                        <div class="lap-time">
                            ${time != null
                                ? moment.utc(time).format('HH:mm:ss.SSS')
                                : '-'}
                        </div>
                    </div>
                </div>`;
        });
    }

    html += `
        <div class="row">
            <div class="col-1">
                <div class="total-label">Total</div>
            </div>
            <div class="col-11">
                <div class="total-time">
                    ${row.totalTime != null
                        ? moment.utc(row.totalTime).format('HH:mm:ss.SSS')
                        : '-'}
                </div>
            </div>
        </div>
    </div></div>`;

    return html;
}



function registryInputFormatter(index, row) {
   var html = `<div class="registryDetail row">`;
   html += `<div id="inputGroup${index}" class="col-sm-6">
      <div class='inputs'>`
   if (row.times) {
      row.times.forEach((element, i) => {
         html += `
         <div class="form-group row">
         <label for="lap-${index}-${i}" class="col-sm-3 text-end control-label col-form-label">LAP [${i}]</label>
         <div class="col-sm-3">
         <input type="text" data-id="${index}" class="form-control registry-time-inputmask" id="lap-${index}-${i}" name="lap-${index}-${i}" placeholder="" value='${moment.utc(row.times[i]).format('HH:mm:ss.SSS')}}' />
         </div>
         </div>`
      });
   }
   html += `</div>`
   html += `<div class="totalTime">
   <div class="form-group row">
   <label for="EntryTotalTime" class="col-sm-3 text-end control-label col-form-label">Total</label>
   <div class="col-sm-3">
   <input type="text" class="form-control" id="EntryTotalTime${index}" name="EntryTotalTime" placeholder="hh:mm:ss.sss" data-inputmask="99:99:99.999" value='${moment.utc(row.totalTime).format('HH:mm:ss.SSS')}' readonly />
   </div>
   </div>
   </div>`
   html += `</div>`
   html += `
   <div class="col-sm-6">
   <button type="button" class="btn btn-info btn-lg" onclick="addInput(${index})"><i class="fa-solid fa-circle-plus"></i></button>
   <button type="button" class="btn btn-warning btn-lg" onclick="saveRegistry(${index})"><i class="fa-regular fa-floppy-disk"></i></button>
   </div>`

   html += `</div>`
   return html
}

function addInput(index) {
   group = $(`#inputGroup${index}`)
   inputs = $(`#inputGroup${index} :input[id^="lap"]`)


   html = `<div class="form-group row">
   <label for="lap-${index}-${inputs.length}" class="col-sm-3 text-end control-label col-form-label">LAP [${inputs.length}]</label>
   <div class="col-sm-3">
   <input type="text" data-id="${index}" class="form-control registry-time-inputmask" id="lap-${index}-${inputs.length}" name="lap-${index}-${inputs.length}" placeholder="" value='' />
   </div>
   </div>`

   $(`#inputGroup${index} .inputs`).append(html)

   $(`.registry-time-inputmask`).inputmask({
      mask: "99:99:99.999",
      jitMasking: true,
      numericInput: true,
   })
   $(`.registry-time-inputmask`).on('keyup', function (e) {
      if (e.keyCode == 13) {
         e.preventDefault();
         index = parseInt($(this)[0].id.split('-')[2]);
         id = ($(this)[0].id).split('-')[1];
         if ($(`#lap-${id}-${index + 1}`).length > 0) $(`#lap-${id}-${index + 1}`).focus();
         else $(`#EntryTotalTime${id}`)[0].focus()
      }
   })
   $(`.registry-time-inputmask`).on('focusout', function (e) {
      id = $(this)[0].id.split('-')[1];
      $(this).inputmask('setvalue', $(this).inputmask('unmaskedvalue').padStart(9, "0"))
      calculateTotal(id);
   })

}

function formatterMillisecondsArray(value, row, index) {
   html = [];
   value.forEach(element => {
      if (element) html.push(`${moment.utc(element).format('HH:mm:ss.SSS')}`)

   });
   return html.join(', ')
}

var countries = [];
async function getCountries() {
   if (countries.length == 0) {
      let data = await getCountriesFromServer();
      for (const key in data.countries) {
         if (Object.hasOwnProperty.call(data.countries, key)) {
            const element = data.countries[key];
            countries.push({ id: key, text: element })
         }
      }
   }
   return countries;
}
function getCountriesFromServer() {
   return new Promise((resolve, reject) => {
     $.getJSON(`/country-list/${core.getOptions().locale}.json`, data => {
       resolve(data);
     }); 
   })
 }

