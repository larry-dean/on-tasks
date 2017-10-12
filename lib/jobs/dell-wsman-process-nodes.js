// Copyright 2016, DELL, Inc.

'use strict';

var di = require('di'),
    urlParse = require('url-parse');

module.exports = DellWsmanProcessNodesJobFactory;
di.annotate(DellWsmanProcessNodesJobFactory, new di.Provide('Job.Dell.Wsman.ProcessNodes'));
di.annotate(DellWsmanProcessNodesJobFactory, new di.Inject(
    'Job.Base',
    'Logger',
    'Promise',
    'Assert',
    'Util',
    'Services.Waterline',
    'Services.Lookup',
    'Services.Configuration',
    '_',
    'HttpTool',
    'Errors',
    'JobUtils.WorkflowTool',
    'Protocol.Events',
    'validator',
    'JobUtils.RedfishTool'
));

function DellWsmanProcessNodesJobFactory(
    BaseJob,
    Logger,
    Promise,
    assert,
    util,
    waterline,
    lookup,
    configuration,
    _,
    HttpTool,
    errors,
    workflowTool,
    eventsProtocol,
    validator,
    RedfishTool
) {
    var logger = Logger.initialize(DellWsmanProcessNodesJobFactory);

    /**
     * @param {Object} options task options object
     * @param {Object} context graph context object
     * @param {String} taskId running task identifier
     * @constructor
     */
    function DellWsmanProcessNodesJob(options, context, taskId) {
        DellWsmanProcessNodesJob.super_.call(this,
                                   logger,
                                   options,
                                   context,
                                   taskId);

        assert.object(this.options);
        this.user = options.credentials.userName;
        this.password = options.credentials.password;
        this.nodeId = this.context.target || undefined;
        this.redfishUDM = options.redfishUDM;
        this.nodeData = options.data || undefined;
        this.redfish = new RedfishTool();

    }

    util.inherits(DellWsmanProcessNodesJob, BaseJob);


    /**
     * @memberOf DellWsmanProcessNodesJob
     */
    DellWsmanProcessNodesJob.prototype._run = function () {
    	var self = this;
        logger.info("*********** LDVP  Enter _run ************");


        self.dell = configuration.get('dell');
        if (!self.dell || !self.dell.services || !self.dell.services.discovery) {
        	throw new errors.NotFoundError('Dell Discovery web service is not defined in wsmanConfig.json.');
        }
        if(!self.nodeId) {
    	    throw new Error('Node ID is required.');
    	}
        logger.info("*********** Node ID: " + self.nodeId);

    	//if(self.validateNodeData() === false) {
    	//    throw new Error('Invalid node data.');
    	//}
        logger.info("*********** processNode ************");

    	return Promise.resolve(self.processNode())
//        .then(function(){
//        	self._done();
//        })
        .catch(function(err){
        	self._done(err);
        });
    }

    DellWsmanProcessNodesJob.prototype.dataFactory = function(identifier, dataName) {
        logger.info("LAD *********** id: " + identifier + " dataName: " + dataName);

        switch(dataName)  {
            case 'ohai':
            case 'dmi':
            case 'smart':
            case 'hardware':
            case 'boot':
            case 'bios':
            case 'nics':
            case 'DeviceSummary':
            case 'UCS':
            case 'UCS:locator-led':
            case 'UCS:bios':
            case 'UCS:board':
                return waterline.catalogs.findLatestCatalogOfSource(identifier, dataName);
            case 'chassis':
                return waterline.nodes.findByIdentifier(identifier)
                .then(function(node) {
                    return _.filter(node.relations, function(relation) {
                        return relation.relationType === 'enclosedBy';
                    }).map(function(relation) {
                        return relation.targets[0];
                    });
                 });
        }
    };

    DellWsmanProcessNodesJob.prototype.processNode = function() {

    	var self = this;

        //var computeNode = null;
        //var nodeType = self.nodeData.deviceType;

        return waterline.nodes.getNodeById(self.nodeId)
        .then(function(node) {
            logger.info("**************** LDVP: redfishUDM: " + self.redfishUDM);
            if (self.redfishUDM && node) {
                logger.info("LDVP *********** node: " + JSON.stringify(node, null, 4));
                // Call through self.clientRequest to do insertion of new or updated system
                // for example:   POST: /redfish/insertSystem 
                return [node.id, self.dataFactory(node.id, 'hardware')]; 
            }
        })
        .spread(function(identifier, hardware) {
            logger.info("LDVP ************************ hardware" + JSON.stringify(hardware, null, 4));
            self.updateCache(identifier, hardware);
        })
        .then(function(){
           self._done();
        })
        .catch(function(err){
            self._done(err);
        })
    }

    DellWsmanProcessNodesJob.prototype.updateCache = function (identifier, hardware) {
 
        var self = this;
        var ipAddr = "localhost"
        var port = "8080"
        var host = 'https://' + ipAddr + ':' + port 
        var path = '/redfish/v1/Systems/'+ identifier;
        var method = 'POST';
        var data = hardware;
      
        logger.info('IP Range discovery submitted...');
        return self.clientRequest(host, path, method, data)
        .then(function(result) {
            logger.info("**** client request result: " + result);
            return result;
        })
        .catch(function(err) {
            logger.info("****" + JSON.stringify(err, null, 4));
            logger.error("Redfish call failed");
            return undefined;
        });
    };


    DellWsmanProcessNodesJob.prototype.clientRequest = function(host, path, method, data) {
        var self = this;

        var parse = urlParse(host);

        var setups = {};

        setups.url = {};
        setups.url.protocol = parse.protocol.replace(':','').trim();
        setups.url.host = parse.host.split(':')[0];
        setups.url.port = parse.port;
        setups.url.path = path || '/';

        setups.method = method || 'GET';
        setups.credential = {};
        setups.verifySSl = false;
        setups.headers = {'Content-Type': 'application/json'};
        setups.recvTimeoutMs = 60000;
        setups.data = data || '';

        logger.info("********LDVP path: " + setups.url.path);
        logger.info("********LDVP method: " + setups.method );
        logger.info("********LDVP host: " + setups.url.host );
        logger.info("********LDVP port: " + setups.url.port );

        var http = new HttpTool();
        
        return http.setupRequest(setups)
        .then(function(){
            return http.runRequest();
        })
        .then(function(response){
            if (response.httpStatusCode > 206) {
                logger.debug(JSON.stringify(response, null, 4));
                var errorMsg = _.get(response, 'body.error.message', 'IP is NOT an iDRAC.');
                throw new Error(errorMsg);
            }

            if (response.body.length > 0) {
                response.body = JSON.parse(response.body);
            }
            return response.body;
        });
    }

    return DellWsmanProcessNodesJob;
}
