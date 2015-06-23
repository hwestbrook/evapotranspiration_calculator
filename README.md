Evapotranspiration Calculator
=========

A very small library to help in calculating evaportranspiration using weather underground as a source

## Installation

  npm install evapotranspiration_calculator --save

## Usage

  var et = require("evapotranspiration_calculator");

  var wundergroundKey = ""; // your wunderground api key
  var pws = ""; // the pws you are using, NOTE: this must has solar radiation and wind speed
  var inputDate = ""; // the date you want to calc ET for
  var canopyReflectionCoefficient = ""; // your reflection coeffecient

  et.calc(wundergroundKey, inputDate, pws, canopyReflectionCoefficient, function(response) {
		console.log(response);
	});

## Tests

  no tests 

## Contributing

Help me write tests? 

## Release History

* 0.1.0 Initial release