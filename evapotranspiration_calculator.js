var moment = require("moment-timezone");
var stats = require("stats-lite");
var request = require("request");
var async = require("async");

exports.calc = function(wundergroundKey, inputDate, pws, canopyReflectionCoefficient, callback) {

	var day = moment(inputDate);

	// http://api.wunderground.com/api/abdfo08898/history_20150522/q/pws: KNUQ.json
	var url = "http://api.wunderground.com/api/" + wundergroundKey + "/conditions/history_" + day.format("YYYYMMDD") + "/q/pws:" + pws + ".json";

	async.waterfall([
    function(callback) {
      request(url, function (error, response, body) {
				if(!error && response.statusCode === 200) {
					var obj = JSON.parse(body);
					callback(null, obj);
				} else {
					callback(error);
				}
			});
    },
    function(obj, callback) {
      // these we need set from an outside source
			// max temp f
			var maxTempF = Number(obj.history.dailysummary[0].maxtempi);

			// min temp f
			var minTempF = Number(obj.history.dailysummary[0].mintempi);

			var solarRadiationReadings = [];

			for (var i = obj.history.observations.length - 1; i >= 0; i--) {
				var solarRadiationReading = Number(obj.history.observations[i].solarradiation);
				solarRadiationReadings.push(solarRadiationReading);
			}

			// mean solar radiation
			var meanSolarRadiationW = stats.mean(solarRadiationReadings);

			// avg wind speed at 2m
			var avgWindSpeedMPH = Number(obj.history.dailysummary[0].meanwindspdi);

			// elevation ft
			var elevationFt = Number(obj.current_observation.display_location.elevation) * 3.28084;

			// max humidity
			var maxHumidity = Number(obj.history.dailysummary[0].maxhumidity);

			// min humidity
			var minHumidity = Number(obj.history.dailysummary[0].minhumidity);

			// latitude
			var latitudeDegrees = Number(obj.current_observation.display_location.latitude);

			// longitude
			var longitudeDegrees = Number(obj.current_observation.display_location.longitude);

			var evapotranspiration = evapotranspiractionCalc(
				maxTempF,
				minTempF,
				meanSolarRadiationW,
				avgWindSpeedMPH,
				elevationFt,
				maxHumidity,
				minHumidity,
				latitudeDegrees,
				canopyReflectionCoefficient,
				day
			);

			callback(null, evapotranspiration);
    }
	], function (err, result) {
			if(err){
				return err;
			}
			else {
				return callback(result);
			}
	});
};

/*

	formulas as functions!

*/

	// calculation constants
	// vapor rate
	var vaporRate = 237.3;

	// enthalpy (?)
	var enthalpy = 17.27;

	// kelvin
	var kelvin = 273.15;

	// solar constant
	var solarConstant = 0.0820;

	function FtoC (F) {
		return (F - 32) / 1.8;
	}

	function FttoM (Ft) {
		return Ft * 0.3048;
	}

	function MJtoW(MJ) {
		return MJ * 0.0864;
	}

	function MPHtoMs(MPH) {
		return MPH * 0.477;
	}

	function DEGtoRAD(DEG) {
		return Math.PI / 180 * DEG;
	}

	function saturationVaporFn(temperature) {
		return (0.6108 * Math.exp((enthalpy * temperature) / (temperature + vaporRate)));
	}

	function saturationVaporPressureCurveSlopeFn(temperature) {
		var top = 4098 * (saturationVaporFn(temperature));
		var bottom = Math.pow((temperature + vaporRate), 2);
		return top / bottom;
	}

	function atmosphericPressueFn(elevationM) {
		var inner = ((293 - 0.0065 * elevationM) / 293);
		return 101.3 * Math.pow(inner, 5.26);
	}

	function psychrometricConstantFn(atmosphericPressue) {
		return 0.000665 * atmosphericPressue;
	}

	function deltaTermFn(saturationVaporPressureCurveSlope, psychrometricConstant, avgWindSpeedMs) {
		var top = saturationVaporPressureCurveSlope;
		var bottom = saturationVaporPressureCurveSlope + psychrometricConstant * (1 + 0.34 * avgWindSpeedMs);
		return top / bottom;
	}

	function psiTermFn(saturationVaporPressureCurveSlope, psychrometricConstant, avgWindSpeedMs) {
		var top = psychrometricConstant;
		var bottom = saturationVaporPressureCurveSlope + psychrometricConstant * (1 + 0.34 * avgWindSpeedMs);
		return top / bottom;
	}

	function temperatureTermFn(meanDailyAirTemperatureC, avgWindSpeedMs) {
		return ((900) / (meanDailyAirTemperatureC + kelvin) * avgWindSpeedMs);
	}

	function saturationVaporPressureActualFn(minTempC, maxTempC, minHumidity, maxHumidity) {
		var rel1 = saturationVaporFn(minTempC) * (maxHumidity/100);
		var rel2 = saturationVaporFn(maxTempC) * (minHumidity/100);
		return stats.mean([ rel1, rel2 ]);
	}

	function relativeEarthSunDifferenceFn(julianDay) {
		return 1 + 0.033 * Math.cos(((2 * Math.PI) / 365) * julianDay);
	}

	function solarDeclinationFn(julianDay) {
		return 0.409 * Math.sin(((2 * Math.PI) / 365) * julianDay - 1.39);
	}

	function sunsetHourAngleFn(latitudeRadians, solarDeclination) {
		return Math.acos(-1 * Math.tan(latitudeRadians) * Math.tan(solarDeclination));
	}

	function extraterrestrialRadiationFn(relativeEarthSunDifference, sunsetHourAngle, latitudeRadians, solarDeclination) {
		var rel1 = 24*60 / Math.PI;
		var rel2 = solarConstant * relativeEarthSunDifference;
		var rel3 = ((sunsetHourAngle * Math.sin(latitudeRadians) * Math.sin(solarDeclination)) + (Math.cos(latitudeRadians) * Math.cos(solarDeclination) * Math.sin(sunsetHourAngle)));
		return rel1 * rel2 * rel3;
	}

	function clearSkySolarRadiationFn(elevationM, extraterrestrialRadiation) {
		return (0.75 + (2 * Math.pow(10, -5)) * elevationM) * extraterrestrialRadiation;
	}

	function netOutgoingLongWaveSolarRadiationFn(minTempC, maxTempC, saturationVaporPressureActual, meanSolarRadiationMJ, clearSkySolarRadiation) {
		var rel1 = 4.903 * Math.pow(10, -9);
		var rel2 = stats.mean([Math.pow((maxTempC + kelvin), 4), Math.pow((minTempC + kelvin), 4)]);
		var rel3 = (0.34 - 0.14 * Math.sqrt(saturationVaporPressureActual));
		var rel4 = 1.35 * meanSolarRadiationMJ / clearSkySolarRadiation - 0.35;
		return rel1 * rel2 * rel3 * rel4;
	}


function evapotranspiractionCalc(maxTempF, minTempF, meanSolarRadiationW, avgWindSpeedMPH, elevationFt, maxHumidity, minHumidity,latitudeDegrees,canopyReflectionCoefficient, day) {

	// these we need to set internally

	var maxTempC = FtoC(maxTempF);

	var minTempC = FtoC(minTempF);

	var elevationM = FttoM(elevationFt);

	var julianDay = day.dayOfYear();



	// step 1, mean daily air temperature C
	var meanDailyAirTemperatureC = stats.mean([ maxTempC, minTempC ]);

	// step 2, mean solar radiation MJ
	var meanSolarRadiationMJ = MJtoW(meanSolarRadiationW);

	// step 3, avg wind speed Ms at 2m
	var avgWindSpeedMs = MPHtoMs(avgWindSpeedMPH);

	// step 4, slope of saturation vapor pressure curve
	var saturationVaporPressureCurveSlope = saturationVaporPressureCurveSlopeFn(meanDailyAirTemperatureC);

	// step 5, atmospheric pressure
	var atmosphericPressue = atmosphericPressueFn(elevationM);

	// step 6, psycometric constant
	var psychrometricConstant = psychrometricConstantFn(atmosphericPressue);

	// step 7, delta term (DT)
	var deltaTerm = deltaTermFn(saturationVaporPressureCurveSlope, psychrometricConstant, avgWindSpeedMs);

	// step 8, psi term (PT)
	var psiTerm = psiTermFn(saturationVaporPressureCurveSlope, psychrometricConstant, avgWindSpeedMs);

	// step 9, temperature term (TT)
	var temperatureTerm = temperatureTermFn(meanDailyAirTemperatureC, avgWindSpeedMs);

	// step 10, mean saturation vapor pressure curve
	var saturationVaporPressureMean = stats.mean([ saturationVaporFn(maxTempC), saturationVaporFn(minTempC) ]);

	// step 11, actual vapor pressure
	var saturationVaporPressureActual = saturationVaporPressureActualFn(minTempC, maxTempC, minHumidity, maxHumidity);

	// step 11.1, vapor pressure deficit
	var saturationVaporPressureDeficit = saturationVaporPressureMean - saturationVaporPressureActual;

	// step 12.1 relative sun earth difference
	var relativeEarthSunDifference = relativeEarthSunDifferenceFn(julianDay);

	// step 12.2 relative sun earth difference
	var solarDeclination = solarDeclinationFn(julianDay);

	// step 13 latitude radians
	var latitudeRadians = DEGtoRAD(latitudeDegrees);

	// step 14 sunset hour angle
	var sunsetHourAngle = sunsetHourAngleFn(latitudeRadians, solarDeclination);

	// step 15 extraterrestrial radiation
	var extraterrestrialRadiation = extraterrestrialRadiationFn(relativeEarthSunDifference, sunsetHourAngle, latitudeRadians, solarDeclination);

	// step 16 clear sky solar radiation
	var clearSkySolarRadiation = clearSkySolarRadiationFn(elevationM, extraterrestrialRadiation);

	// step 17 clear sky solar radiation
	var netSolarRadiation = (1 - canopyReflectionCoefficient) * meanSolarRadiationMJ;

	// step 18  Net outgoing long wave solar radiation
	var netOutgoingLongWaveSolarRadiation = netOutgoingLongWaveSolarRadiationFn(minTempC, maxTempC, saturationVaporPressureActual, meanSolarRadiationMJ, clearSkySolarRadiation);

	// step 19 net radiation
	var netRadiation = netSolarRadiation - netOutgoingLongWaveSolarRadiation;

	// step 19.1 net radiation ng in mm
	var netRadiationMM = netRadiation * 0.408;

	// step FS1 radiation term
	var radiationTerm = deltaTerm * netRadiationMM;

	// step FS2 wind term
	var windTerm = psiTerm * temperatureTerm * (saturationVaporPressureMean - saturationVaporPressureActual);

	// step Final, evapotranspiration value
	var evapotranspirationMM = radiationTerm + windTerm;
	var evapotranspirationIN = evapotranspirationMM * 0.0393701;

/*

	build the output

*/

	var evapoObject = {
		// meanDailyAirTemperatureC: meanDailyAirTemperatureC,
		// meanSolarRadiationMJ: meanSolarRadiationMJ,
		// avgWindSpeedMs: avgWindSpeedMs,
		// saturationVaporPressureCurveSlope: saturationVaporPressureCurveSlope,
		// atmosphericPressue: atmosphericPressue,
		// psychrometricConstant: psychrometricConstant,
		// deltaTerm: deltaTerm,
		// psiTerm: psiTerm,
		// temperatureTerm: temperatureTerm,
		// saturationVaporPressureMean: saturationVaporPressureMean,
		// saturationVaporPressureActual: saturationVaporPressureActual,
		// saturationVaporPressureDeficit: saturationVaporPressureDeficit,
		// relativeEarthSunDifference: relativeEarthSunDifference,
		// solarDeclination: solarDeclination,
		// latitudeRadians: latitudeRadians,
		// sunsetHourAngle: sunsetHourAngle,
		// extraterrestrialRadiation: extraterrestrialRadiation,
		// clearSkySolarRadiation: clearSkySolarRadiation,
		// netSolarRadiation: netSolarRadiation,
		// netOutgoingLongWaveSolarRadiation: netOutgoingLongWaveSolarRadiation,
		// netRadiation: netRadiation,
		// netRadiationMM: netRadiationMM,
		// radiationTerm: radiationTerm,
		// windTerm: windTerm,
		evapotranspirationMM: evapotranspirationMM,
		evapotranspirationIN: evapotranspirationIN
	};

	return evapoObject;

}
