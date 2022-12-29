const mongoose = require('mongoose');
var Schema = mongoose.Schema;

// creating user schema
const ClubSchema = mongoose.Schema({
    name : {
        type : String,
    },
    shortName : {
        type : String,
    }
},
{ timestamps: true });

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Club', ClubSchema);

