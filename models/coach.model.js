const mongoose = require('mongoose');
var Schema = mongoose.Schema;


// creating user schema
const CoachSchema = mongoose.Schema({
    name : {
        type : String,
        required : true
    },
    lastname : {
        type : String,
        required : true
    },
    clubs : {
        type : [Schema.Types.ObjectId],
        ref : 'Club',
        combo : { collection : {name : 'Club', text : 'name'}, multiple : true}
    },
    user : {
        type : Schema.Types.ObjectId,
        ref : 'User',
        combo : { collection : {name : 'User', text : 'username'}}
    }
}, {
    timestamps : true,
    toObject: {
        virtuals: true
    },
    toJSON: {
        virtuals: true 
    }
});

CoachSchema.virtual('fullname')
.get(function () {
//   return this.lastname;
  return titleCase(this.name) + ' ' + (this.lastname ? this.lastname.toUpperCase() : '');
});

function titleCase(str) {
    if (!str) return null;
    var splitStr = str.toLowerCase().split(' ');
    for (var i = 0; i < splitStr.length; i++) {
        // You do not need to check if i is larger than splitStr length, as your for does that for you
        // Assign it back to the array
        splitStr[i] = splitStr[i].charAt(0).toUpperCase() + splitStr[i].substring(1);     
    }
    // Directly return the joined string
    return splitStr.join(' '); 
 }

// exporting module to allow it to be imported in other files
module.exports = mongoose.model('Coach', CoachSchema);
