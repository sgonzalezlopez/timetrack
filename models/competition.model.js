const mongoose = require('mongoose');
const moment = require('moment')
moment.locale('es')

var Schema = mongoose.Schema;

// creating user schema
const CompetitionSchema = mongoose.Schema({
    name : {
        type : String,
    },
    date : {
        type : Date,
    },
    dateEnd : {
        type : Date,
    },
    season : {
        type : String,
    },
    training : {
        type : Boolean,
        default : false,
    },
    track : {
        type : Schema.Types.ObjectId,
        ref : 'Track',
        combo : { collection : {name : 'Track', text : 'name'}} 
    }
}, {
    timestamps: true, 
    toObject: {
        virtuals: true
    },
    toJSON: {
        virtuals: true 
    }
});

CompetitionSchema.virtual('fullname')
.get(function () {
    return `${this.name} - ${moment(this.date).format('L')} (${this.track ? this.track.name : ''})`;
});

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Competition', CompetitionSchema);

