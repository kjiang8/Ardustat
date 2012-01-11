var http = require("http");
var url = require("url");
var fs = require('fs');
var glob = require('glob');
var qs = require('querystring');
var express = require('express'),
    app = express.createServer();
	app.use(express.bodyParser());
	app.use(app.router);

io = require('socket.io').listen(app);
io.set('log level', 1)
var serialport = require("serialport")
var SerialPort = require("serialport").SerialPort

var serialPort = new SerialPort(glob.globSync("/dev/tty.u*")[0],{baudrate:57600,parser:serialport.parsers.readline("\n") });
var datastream = ""

app.use("/flot", express.static(__dirname + '/flot'));
app.use("/socket.io", express.static(__dirname + '/node_modules/socket.io/lib'));


app.get('/', function(req, res){
	indexer = fs.readFileSync('index.html').toString()
    res.send(indexer);
});


app.get('/debug', function(req, res){
	indexer = fs.readFileSync('debug.html').toString()
    res.send(indexer);
});


function setStuff(req,res)
{
	if (req.body.arducomm != undefined) serialPort.write(req.body.arducomm)
	if (req.body.command != undefined)
	{
		if (req.body.command == "calibrate")
		{
			console.log("calibration should start");
			calibrator(req.body.value);
		}
		
	}
	res.send(req.body)
	
}

app.post('/senddata', setStuff,function(req, res,next){
	console.log(req.body)
	res.send(req.body)
	
});

fudge = "factor"

app.post('/getdata',function(req, res){
	res.send(req.app.settings)
});


function datadoer()
{
	return datastream
}

app.listen(8888);
console.log('Express server started on port %s', app.address().port);

id = 20035;
mode = 0;
var res_table;
function data_parse(data)
{
	parts = data.split(",")
  	out = {}

	//the raw data
	//console.log(data)
	out['dac_set'] = parseFloat(parts[1])
	out['cell_adc'] = parseFloat(parts[2])
	out['dac_adc'] = parseFloat(parts[3])
	out['res_set'] = parseFloat(parts[4])
	out['mode'] = parseInt(parts[6])
	out['gnd_adc'] = parseFloat(parts[8])
	out['ref_adc'] = parseFloat(parts[9])
	out['twopointfive_adc'] = parseFloat(parts[10])
	out['id'] = parseInt(parts[11])
	//making sense of it
	volts_per_tick = 	2.5/out['twopointfive_adc']
	if (id != out['id'])
	{
		id = out['id'];
		res_table = undefined
	}
	
	
	if (mode != out['mode'])
	{
		mode = out['mode'];
		
	}
	out['cell_potential'] = (out['cell_adc'] - out['gnd_adc']) * volts_per_tick
	out['dac_potential'] = (out['dac_adc'] - out['gnd_adc'])*volts_per_tick
	out['ref_potential'] = out['ref_adc']*volts_per_tick
	out['gnd_potential'] = out['gnd_adc']*volts_per_tick
	out['working_potential'] = (out['cell_adc'] - out['ref_adc']) * volts_per_tick
	
	if (res_table == undefined)
	{
		try
		{
			res_table = JSON.parse(fs.readFileSync("unit_"+id.toString()+".json").toString())
			console.log("loaded table "+id.toString())
			
			
		}
		catch (err)
		{
			console.log(err)
			console.log("no table "+id.toString())
			res_table = "null"
		}
	}
	
	if (res_table.constructor.toString().indexOf("Object")>-1)
	{
		out['resistance'] = res_table[out['res_set']]
		current = (out['dac_potential']-out['cell_potential'])/out['resistance']
		if (mode == 1) out['current'] = 0
		else out['current'] = current
	}
	
	return out
}


serialPort.on("data", function (data) {
	if (data.search("GO")>-1)
	{
		foo = data_parse(data);
		d = new Date().getTime()	
		foo['time'] = d	 	
		io.sockets.emit('new_data',{'ardudata':foo} )
		app.set('ardudata',foo)
		if (calibrate)
		{
			calibration_array.push(foo)
		}
	}
});


//CALIBRATION PORTION
//What happens
//1) We intitialize a counter, a loop counter,a loop limit and a callibration array
//2) When the function is called we flip the boolean and scan 
calibrate = false
counter = 0
calloop = 0
callimit = 2
calibration_array = []
rfixed = 10000

function calibrator(value)
{
	rfixed = parseFloat(value)
	console.log(rfixed)
	calibrate = false
	counter = 0
	calloop = 0
	serialPort.write("R0255")
	setTimeout(function(){calibrate = true},100)
}

setInterval(function(){
	serialPort.write("s0000")
	if (calibrate)
	{   
		counter++;
		if (counter > 255)
		{
			counter = 0	
			calloop++
			if (calloop > callimit)
			{
				calibrate = false
				out_table = {}
				for (i = 0; i < calibration_array.length; i++)
				{
					this_foo = calibration_array[i]
					res_set = this_foo['res_set']
					dac_potential = this_foo['dac_potential']
					cell_potential = this_foo['cell_potential']
					gnd_potential = this_foo['gnd_potential']
					res_value = rfixed*(((dac_potential-gnd_potential)/(cell_potential-gnd_potential)) - 1)					
					if (out_table[res_set] == undefined) out_table[res_set] = []
					out_table[res_set].push(res_value)
				}
				console.log(out_table)
				final_table = {}
				for (var key in out_table)
				{
					if (out_table.hasOwnProperty(key)) 
					{
						arr = out_table[key]
						sum = 0
						for (var i = 0; i < arr.length; i ++)
						{
							sum = sum + arr[i]
						}
						average = sum/(arr.length)
						final_table[key] = average
					}
				  
				}
				console.log(final_table)
				fs.writeFileSync("unit_"+id.toString()+".json",JSON.stringify(final_table))
				res_table = undefined;
			}
		} 
		setTimeout(function(){serialPort.write(ardupadder("r",counter))	},50);
	
	}
},100)

//Helpers
//Format raw entry for ardustat
function ardupadder(command,number)
{
	if (number < -1) number=Math.abs(number)+2000
	
	padding = "";
	if (number < 10) padding = "000";
	else if (number < 100) padding= "00";
	else if (number < 1000) padding= "0";
	out = command+padding+number.toString()
	return out
	
}