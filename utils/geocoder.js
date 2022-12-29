const NodeGeocoder = require('node-geocoder')

const options = {
   provider : 'locationiq',
   apiKey : 'pk.e614e6e48bc2e93a31d3994d7ea9f383'
}

const geocoder = NodeGeocoder(options)

exports.geocode = async function geocode(address) {
   try {
      const res = await geocoder.geocode(address);
      return res;
   }
   catch (err) {
      console.error(err);
      throw(err)
   }
}