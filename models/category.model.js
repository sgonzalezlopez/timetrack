const mongoose = require('mongoose');
var Schema = mongoose.Schema;

// creating user schema
const CategorySchema = mongoose.Schema({
    name : {
        type : String,
    },
    from : {
        type : Date,
    },
    to : {
        type : Date,
    }
},
{
    timestamps: true,
    // El formulario necesita `id` en la respuesta para saber que el registro ya existe
    toObject: { virtuals: true },
    toJSON: { virtuals: true }
});

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Category', CategorySchema);

