/*!
 * (c) 2016-2018 EntIT Software LLC, a Micro Focus company
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
*/

'use strict'

var fs = require('fs')
var path = require('path')

var Octane = require('../lib')
var utils = require('../lib/utils')

var META_ROUTES_FILE = '../routes/meta.json'
var DEFAULT_ROUTES_FILE = '../routes/default.json'

function generateDefaultRoutes (configurationJSON) {
  function FileDetails (filename) {
    if (!(this instanceof FileDetails)) return new FileDetails(filename)
    this.filename = filename
    this.exists = fs.existsSync(filename)
  }
  function loadConfigurationFromFile () {
    const commandLineArgs = require('command-line-args')
    const optionDefinitions = [
      { name: 'octaneconfig', alias: 'c', type: FileDetails, defaultOption: true }]
    const options = commandLineArgs(optionDefinitions)
    if (!options.octaneconfig || !options.octaneconfig.exists) {
      console.error(new Error('Cannot load octane configuration file!'))
      process.exit(1)
    }
    return JSON.parse(
      fs.readFileSync(options['octaneconfig']['filename'], 'utf8')
    )
  }

  if (configurationJSON === undefined) {
    configurationJSON = loadConfigurationFromFile()
  }

  initializeOctaneClient(configurationJSON, function (err, client) {
    if (err) {
      console.error(err)
      process.exit(1)
    }

    loadOcatneMetadata(client, function (err, metadata) {
      if (err) {
        console.error(err)
        process.exit(1)
      }

      var routes = initializeRoutes(META_ROUTES_FILE)

      createRoutesFromOctaneMetadata(routes, metadata)

      saveRoutesToFile(routes, DEFAULT_ROUTES_FILE)
    })
  })
}

function initializeOctaneClient (configuration, callback) {
  var client

  console.log('loading Ocatne configuration ...')

  console.log('initializing Octane client ...')
  try {
    client = new Octane(configuration.config)
  } catch (ex) {
    return callback(ex)
  }

  client.authenticate(configuration.options, function (err) {
    if (err) {
      return callback(err)
    }

    callback(null, client)
  })
}

function loadOcatneMetadata (client, callback) {
  var metadata = {}

  console.log('loading entity metadata ...')
  client.metadata.getEntities({}, function (err, entities) {
    if (err) {
      return callback(err)
    }

    console.log('loading field metadata ...')
    client.metadata.getFields({}, function (err, fields) {
      if (err) {
        return callback(err)
      }

      metadata.entities = entities
      metadata.fields = fields
      callback(null, metadata)
    })
  })
}

function initializeRoutes (routesFile) {
  console.log('initializing routes from ' + routesFile + ' ...')
  try {
    return JSON.parse(
      fs.readFileSync(path.join(__dirname, routesFile), 'utf8')
    )
  } catch (ex) {
    console.error(ex)
    process.exit(1)
  }
}

function createRoutesFromOctaneMetadata (routes, metadata) {
  metadata.entities.forEach(function (entity) {
    var name = entity.name
    var fields = metadata.fields.filter(function (field) {
      return field.entity_name === name
    })

    var route = createRoute(entity, fields)

    if (route) {
      var routeName = utils.toDisplayName(name, true)
      routes[routeName] = routes[routeName] || {}
      utils.extend(routes[routeName], route, true)
    }
  })
}

function createRoute (entity, fields) {
  var route
  var name = entity.name

  console.log('creating route for ' + name + ' ...')
  entity.features.forEach(function (feature) {
    if (feature.name === 'rest') {
      route = {}

      var url = feature.url
      var methods = feature.methods
      var params

      if (methods.indexOf('GET') > -1) {
        route['get-all'] = {
          url: '/' + url,
          method: 'GET',
          params: {
            $query: null,
            $limit: null,
            $offset: null,
            $fields: null,
            $order_by: null,
            $text_search: null
          },
          description: 'Gets ' + utils.toDisplayName(name, true) + ' list.'
        }

        route['get'] = {
          url: '/' + url + '/:id',
          method: 'GET',
          params: {
            $id: null,
            $fields: null
          },
          description: 'Gets a single ' + utils.toDisplayName(name) + '.'
        }
      }

      if (methods.indexOf('POST') > -1) {
        params = parseParameters(fields, true)
        route['create'] = {
          url: '/' + url,
          method: 'POST',
          params: params,
          description: 'Create a single ' + utils.toDisplayName(name) + '.'
        }

        route['create-bulk'] = {
          url: '/' + url,
          method: 'POST',
          params: params,
          description: 'Create multiple ' + utils.toDisplayName(name) + '.'
        }
      }

      if (methods.indexOf('PUT') > -1) {
        params = parseParameters(fields, false)
        params['$id'] = null
        route['update'] = {
          url: '/' + url + '/:id',
          method: 'PUT',
          params: params,
          description: 'Update a single ' + utils.toDisplayName(name) + '.'
        }

        route['update-bulk'] = {
          url: '/' + url,
          method: 'PUT',
          params: params,
          description: 'Update multiple ' + utils.toDisplayName(name) + '.'
        }
      }

      if (methods.indexOf('DELETE') > -1) {
        route['delete'] = {
          url: '/' + url + '/:id',
          method: 'DELETE',
          params: {
            $id: null
          },
          description: 'Delete a single ' + utils.toDisplayName(name) + '.'
        }
      }
    }
  })

  return route
}

function parseParameters (fields, isForCreate) {
  var params = {}

  fields.forEach(function (field) {
    var name = field.name
    var label = field.label
    var type = field.field_type

    var required = field.required
    var editable = field.editable
    var final = field.final

    if (!editable) {
      return
    }
    if (final && !isForCreate) {
      return
    }

    params[name] = {
      type: type,
      required: isForCreate ? required : false,
      description: label
    }

    if (type === 'integer') {
      params[name]['min_value'] = field.min_value
      params[name]['max_value'] = field.max_value
    } else if (type === 'string') {
      params[name]['max_length'] = field.max_length
    } else if (type === 'reference') {
      params[name]['field_type_data'] = field.field_type_data
    }
  })

  return params
}

function saveRoutesToFile (routes, file) {
  console.log('saving routes to ' + file + ' ...')
  try {
    fs.writeFileSync(
      path.join(__dirname, file),
      JSON.stringify(routes, null, '\t')
    )
  } catch (ex) {
    console.log(ex)
    process.exit(1)
  }
}

if (require.main === module) {
  generateDefaultRoutes()
}
module.exports.generateDefaultRoutes = generateDefaultRoutes
