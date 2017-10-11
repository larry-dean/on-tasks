// Copyright 2016, Dell EMC, Inc.

'use strict';

module.exports = {
    friendlyName: "Dell Wsman ProcessNodes",
    injectableName: "Task.Dell.Wsman.ProcessNodes",
    implementsTask: "Task.Base.Dell.Wsman.ProcessNodes",
    options: {
		data: null,
		credentials:{
			user: null,
			password: null
		},
                redfishUDM: true
    },
    properties: {}
};
