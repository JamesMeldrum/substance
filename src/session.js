(function(root) {

var Substance = root.Substance;
var util = Substance.util;
var _ = root._;
var ot = Substance.Chronicle.ot;
var Data = root.Substance.Data;
var Library = root.Substance.Library;


// Substance.Session
// -----------------
//
// The Composer works with a session object, which maintains
// all the state of a document session
// TODO: No multiuser support yet, use app.user

var Session = function(options) {
  // an instance id to analyze problems with
  this.__id__ = util.uuid();
  this.env = options.env;
  this.chronicle = Substance.Chronicle.create(Substance.Chronicle.Index.create());
  this.initStores();
  this.library = new Library();
  this.seedLibrary();
};

Session.__prototype__ = function() {

  // Temporary library seeding
  // -----------------
  //

  this.seedLibrary = function() {
    var ids = [];
    _.each(LIBRARY_SEED.objects, function(o) {
      
      var op = Data.Graph.Create({
        id: o._id,
        type: "article",
        title: o.name, // derive dynamically
        keywords: o.keywords,
        creator: o.authors[0] || "Michael Aureiter", // derive dynamically
        collaborators: o.authors,
        publications: o.subjects, // derive dynamically
        published_at: o.published_at, // derive dynamically
        created_at: o.published_at,
        updated_at: o.published_at
      });

      this.library.exec(op);
      ids.push(o._id);
    }, this);


    // Create my documents collection
    var op1 = Data.Graph.Create({
      id: "my_documents",
      type: "collection",
      name: "My Documents",
      documents: ids.splice(0, 40)
    });

    this.library.exec(op1);

    // Create collaborations collection
    var op2 = Data.Graph.Create({
      id: "my_collaborations",
      type: "collection",
      name: "My Collaborations",
      documents: ids.slice(10, 20)
    });
    this.library.exec(op2);
  };

  this.getUserStore = function(username) {
    var scope = username ? this.env+":"+username : this.env;

    if (Substance.client_type === "native") {
      var settings = {
        scope: scope
      };
      return new Substance.RedisStore(settings);
    }
    if (Substance.LocalStore) {
      return new Substance.LocalStore(scope);
    }

    return new Substance.MemoryStore();
  };

  this.lazySync = _.debounce(function() {
    if (!this.pendingSync) return;
    this.replicate();
  }, 4000);

  this.getClient = function() {
    var token = this.token();
    var config = Substance.config();
    return new Substance.Client({
      "hub_api": config.hub_api,
      "client_id": config.client_id,
      "client_secret": config.client_secret,
      "token": token
    });
  };

  this.initStores = function() {
    var username = this.user();
    this.client = this.getClient();

    if (username) {
      this.localStore = this.getUserStore(username);
      this.remoteStore = this.client.getUserStore(username);
    } else {
      this.localStore = null;
      this.remoteStore = null;
    }
  };

  // When a doc changes, bind event handlers etc.
  this.initDoc = function() {
    this.selections = {};

    // Comments view
    this.comments = new Substance.Comments(this);

    // Register user
    this.users = {};
    this.users[this.user()] = {
      "color": "#2F2B26",
      "selection": []
    };
  };

  // Create a new document locally
  // Schema is optional (currently only used by testsuite)
  this.createDocument = function(schema) {
    var document = new Substance.Document({
      id: Substance.util.uuid(),
      meta: {
        "creator": this.user(),
        "created_at": new Date()
      }
    }, schema);


    // this.localStore.create(document.id, {
    //   meta: document.meta,
    //   commits: document.commits,
    //   refs: document.refs
    // });

    this.document = new Session.Document(this, document, schema);
    this.initDoc();
  };

  this.synched = function(docId) {
    // TODO: this should not be here as it contains implementation details
    var refs = this.localStore.getRefs(docId);
    if (refs.master) {
      return refs.master.head === refs['master']['remote-head'];
    } else {
      return false;
    }
  };

  // List documents for a given collection
  // --------
  // 
  // TODO: let collection describe which facets should be exposed


  this.listDocuments = function(collection) {
    var c = this.library.getCollection(collection);
    
    var kenSession = new Ken.Session({
      collection: c.documents,
      facets: [
        {
          "property": "publications",
          "name": "Networks"
        },
        {
          "property": "keywords",
          "name": "Keywords"
        }
      ]
    });
    return kenSession;
  };

  // Get Dashboard Data
  // --------
  // 

  this.getDashboard = function(collection) {
    return {
      "collections": [
        this.library.get('my_documents'),
        this.library.get('my_collaborations')
      ],
      "active_collection": collection,
      "documents": new Ken.Session({
        collection: this.library.getCollection(collection).documents,
        facets: [
          {
            "property": "publications",
            "name": "Networks"
          },
          {
            "property": "keywords",
            "name": "Keywords"
          }
        ]
      })
    };
  };

  // Load new Document from localStore
  this.loadDocument = function(id, cb) {
    var that = this;

    $.ajax({
      dataType: "jsonp",
      url: 'http://elife-converter.herokuapp.com/documents/'+id,
      success: function(eLilfeDoc) {
        // Construct on the fly

        // Start with an empty doc
        var doc = new Substance.Document({id: id});

        // Supports text and heading nodes
        function insert(node) {
          var id = _.htmlId(node.id).replace('-', '_');
          doc.exec(["create", {
            "id": id,
            "type": node.type,
            "content": node.content
          }]);

          // position
          doc.exec(["position", "content", {"nodes": [id], "target": -1 }]);
        }

        function annotate(a) {
          var type = a.type;

          if (type === "figure_reference") type = "idea";
          if (type === "publication_reference") type = "question";
          if (type === "underline") type = "emphasis";

          if (!_.include(["idea", "question", "emphasis", "strong", "link"], type)) {
            // console.log('skipping ', type);
            return; // skip
          } else {
            // console.log('adding ', type);
          }
          if (a.key !== "content") return; // skip elife specific annotations

          var id = _.htmlId(a.id);
          var target = _.htmlId(a.source);

          // console.log('annotating..');
          doc.exec(["annotate", target, a.key, {
            "id": id,
            "type": type,
            "range": {start: a.pos[0], length: a.pos[1]}
          }]);
          
        }

        _.each(eLilfeDoc.views.content, function(n) {
          var node = eLilfeDoc.nodes[n];
          if (_.include(["text", "heading"], node.type)) {
            insert(node);
          }
        });

        // Add annotations
        _.each(eLilfeDoc.nodes, function(node) {
          annotate(node);
        });

        that.document = doc;
        that.initDoc();

        cb(null, doc);
      },
      error: function() {
        cb('error');
      }
    });
  };


  this.deleteDocument = function(id) {
    this.localStore.delete(id);
  };

  // Replicate local docstore with remote docstore
  this.replicate = function(cb) {
    this.pendingSync = false;

    var replicator = this.createReplicator();

    this.trigger('replication:started');

    var that = this;
    replicator.sync(function(err) {
      if(err) console.log("Error during replication: ", err);
      that.trigger('replication:finished', err);
      if (cb) cb(err);
    });
  };

  // Select a document
  // Triggers re-render of comments panel etc.
  this.select = function(nodes, options) {

    if (!options) options = {};
    var user = this.user(); // Use current user by default

    // Do nothing if selection hasn't changed
    // It's considered a change if you operate on the same node
    // but change from edit to selection mode (options.edit check)
    if (!this.selectionChanged(user, nodes, !!options.edit)) return;

    this.edit = !!options.edit;

    if (this.users[user].selection) {
      _.each(this.users[user].selection, function(node) {
        delete this.selections[node];
      }, this);
    }

    this.users[user].selection = nodes;
    _.each(nodes, function(node) {
      this.selections[node] = user;
    }, this);

    // New selection leads to new comment context
    this.comments.compute();
    this.trigger('node:selected');
  };

  this.createPublication = function(network, cb) {
    var doc = this.document;

    var that = this;
    this.client.createPublication(doc.id, network, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  };

  this.deletePublication = function(id, cb) {
    var that = this;
    this.client.deletePublication(id, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  };

  this.createVersion = function(cb) {
    var doc = this.document;
    var data = doc.toJSON(true); // includes indexes

    var blobs = {};

    // Push document cover?
    if (doc.properties.cover_medium) {
      blobs[doc.properties.cover_medium] = doc.store.getBlob(doc.properties.cover_medium);
      blobs[doc.properties.cover_large] = doc.store.getBlob(doc.properties.cover_large);
    }

    // Find all images
    _.each(doc.nodes, function(node) {
      if (node.type === "image") {
        blobs[node.medium] = doc.store.getBlob(node.medium);
        blobs[node.large] = doc.store.getBlob(node.large);
      }
    });

    // Attach blob data to body
    data.blobs = blobs;

    // Now create version on the server
    var that = this;
    this.client.createVersion(doc.id, data, function(err) {
      if (err) return cb(err);
      doc.meta.published_at = new Date();
      doc.meta.published_commit = that.chronicle.getState();
      doc.store.update({meta: doc.meta});
      that.loadPublications(cb);
    });
  };

  // Unpublish document
  this.unpublish = function(cb) {
    var doc = this.document;
    this.client.unpublish(doc.id, function(err) {
      if (err) return cb(err);
      delete doc.meta["published_at"];
      delete doc.meta["published_commit"];
      doc.store.update({meta: doc.meta});
    });
  };

  // Retrieve current publish state
  this.publishState = function() {
    var doc = this.document;
    if (!doc.meta.published_commit) return "unpublished";
    if (this.chronicle.getState() === doc.meta.published_commit) return "published";
    return "dirty";
  };

  // Checks if selection has actually changed for a user
  this.selectionChanged = function(user, nodes, edit) {
    // this.edit remembers the previous selection/edit state
    return !_.isEqual(nodes, this.selection(user)) || edit !== this.edit;
  };

  // Retrieve current node selection
  this.selection = function(user) {
    if (!user) user = this.user();
    return this.users[user].selection;
  };

  // Returns the node id of current active node
  // Only works if there's just one node selected
  this.node = function() {
    var lvl = this.level(),
        sel = this.selection();

    if (lvl >= 2 && sel.length === 1) {
      return sel[0];
    }
  };

  // Returns current navigation level (1..3)
  this.level = function() {
    var selection = this.users[this.user()].selection;

    // Edit mode
    if (this.edit) return 3;

    // Selection mode (one or more nodes)
    if (selection.length >= 1) return 2;

    // no selection -> document level
    return 1;
  };

  // Load Publish state
  this.loadPublications = function(cb) {
    var doc = this.document;
    var that = this;

    this.client.listNetworks(function(err, networks) {
      if (err) return cb(err);
      that.networks = networks; // all networks

      that.client.listPublications(doc.id, function(err, publications) {
        if (err) return cb(err);
        that.publications = publications;

        _.each(that.publications, function(p) {
          // Attach network information
          p.network = _.find(that.networks, function(n) { return n.id === p.network; });
        });

        cb(null);
      });
    });
  };

  // Load Collaborators for current document
  this.loadCollaborators = function(cb) {
    var doc = this.document;
    var that = this;
    this.client.listCollaborators(doc.id, function(err, collaborators) {
      if (err) return cb(err);
      //console.log('client.loadCollaborators: collaborators', collaborators);
      that.collaborators = collaborators;
      cb(null);
    });
  };

  // Create new collaborator on the server
  this.createCollaborator = function(collaborator, cb) {
    var doc = this.document;
    var that = this;
    this.client.createCollaborator(doc.id, collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  };

  // Delete collaborator on the server
  this.deleteCollaborator = function(collaborator, cb) {
    var that = this;
    this.client.deleteCollaborator(collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  };

  this.setProperty = function(key, val) {
    Substance.settings.setItem(this.env+":"+key, val);
  };

  this.getProperty = function(key) {
    return Substance.settings.getItem(this.env+":"+key);
  };

  this.user = function() {
    return this.getProperty('user') || "";
  };

  this.token = function() {
    return this.getProperty('api-token') || "";
  };

  // Authenticate session
  this.authenticate = function(username, password, cb) {
    var that = this;
    this.client.authenticate(username, password, function(err, data) {
      if (err) return cb(err);
      that.setProperty('user', username);
      that.setProperty('api-token', data.token);

      that.initStores();
      cb(null, data);
    });
  };

  this.logout = function() {
    this.localStore = null;
    this.remoteStore = null;
    this.setProperty('user', '');
    this.setProperty('api-token', '');
  };

  this.authenticated = function() {
    return !!this.getProperty("user");
  };

  // Create a new user on the server
  this.createUser = function(user, cb) {
    this.client.createUser(user, cb);
  };

  this.createReplicator = function() {
    return new Substance.Replicator2({local: this.localStore, remote: this.remoteStore, remoteID: "substance.io"});
  };

  // only available for testing
  this.seed = function(seedData) {
    console.log("Seeding local store", seedData);
    if (this.env !== "test") return;
    // Note: usually we do not want to use this function, only for seeding
    this.getUserStore(this.user()).impl.clear();
    _.each(seedData, function(seed, user) {
      var userStore = this.getUserStore(user);
      userStore.seed(seed);
    }, this);
  };
};

Session.prototype = new Session.__prototype__();
_.extend(Session.prototype, util.Events);

Session.Document = function(session, document, schema) {
  // TODO: Use versioned doc
  // Substance.VersionedDocument.call(this, session.chronicle, document, schema);
  Substance.Document.call(this, document, schema);
  // this.doc = new Document({"id": "substance-doc"});
      
  // 1. create heading
  this.exec(["create", {
    "id": "h1",
    "type": "heading",
    "content": "Hello World",
    "level": 1
  }]);

  // 2. create text
  this.exec(["create", {
    "id": "t1",
    "type": "text",
    "content": "Woot"
  }]);

  // 3. create more text
  this.exec(["create", {
    "id": "t2",
    "type": "text",
    "content": "Even more text."
  }]);

  // 4. position elements
  this.exec(["position", "content", {"nodes": ["h1", "t1", "t2"], "target": -1 }]);

  // 5. Add annotation to t1
  this.exec(["annotate", "t2", "content", {
    "id": "a1",
    "type": "idea",
    "range": {start: 1, length: 3}
  }]);

  // 6. Add annotation to t1
  this.exec(["annotate", "t2", "content", {
    "id": "a2",
    "type": "strong",
    "range": {start: 5, length: 3}
  }]);

  this.store = new Session.DocumentStore(session, document.id);
};

Session.Document.__prototype__ = function() {

  var __super__ = util.prototype(this);

  // Persists the change before triggering any observers.
  // the chronicled doc takes over that repsonsibility now
  
  // this.apply = function(operation, options) {
  //   options = options || {};
  //   // apply the operation to the document (Substance.Document.apply)
  //   // without triggering events

  //   console.log('operation coming in is:', operation);
  //   var commit = __super__.apply.call(this, operation, _.extend({}, options, {"silent": true}));

  //   if(!options['silent']) {
  //     this.trigger('commit:applied', commit);
  //   }
  // };
};

// inherit the prototype of Substance.Document which extends util.Events
Session.Document.__prototype__.prototype = Substance.Document.prototype;
Session.Document.prototype = new Session.Document.__prototype__();

// A facette of the localStore for a specific document
Session.DocumentStore = function(session, docId) {
  this.id = docId;
  this.session = session;
  this.store = session.localStore;
};

Session.DocumentStore.__prototype__ = function() {

  this.getInfo = function() {
    return this.store.getInfo(this.id);
  };

  this.get = function() {
    return this.store.get();
  };

  this.commits = function(last, since) {
    if (arguments.length === 0) return this.store.commits(this.id);
    return this.store.commits(this.id, {last: last, since: since});
  };

  this.update = function(options) {

    // Triggers a sync with remote store if available
    this.session.pendingSync = true;
    this.session.lazySync();

    return this.store.update(this.id, options);
  };

  this.getRefs = function(branch) {
    return this.store.getRefs(this.id, branch);
  };

  this.setRefs = function(branch, refs) {
    return this.store.setRefs(this.id, branch, refs);
  };

  // Blob API
  // --------

  this.createBlob = function(blobId, base64data) {
    return this.store.createBlob(this.id, blobId, base64data);
  };

  // TODO: reactivate
  this.getBlob = function(blobId) {
    // Note: check before delegation to make this call non-failing,
    // instead null is returned.
    // return this.store.hasBlob(this.id, blobId) ? this.store.getBlob(this.id, blobId) : null;
    return null;
  };

  this.hasBlob = function(blobId) {
    return this.store.hasBlob(this.id, blobId);
  };

  this.deleteBlob = function(blobId) {
    return this.store.deleteBlob(this.id, blobId);
  };

  this.listBlobs = function() {
    return this.store.listBlobs(this.id);
  };

};

Session.DocumentStore.prototype = new Session.DocumentStore.__prototype__();




// Comments
// -----------------
// This seems to be very UI specific and should be removed from Substance.Session

Substance.Comments = function(session) {
  this.session = session;
  this.scopes = [];
};

_.extend(Substance.Comments.prototype, _.Events, {
  compute: function(scope) {
    var node = this.session.node();
    this.scopes = [];

    var content, annotations;
    if (node) {
      var nodeData = this.session.document.nodes[node];
      content = nodeData.content;
      annotations = this.session.document.find('annotations', node);
    }
    this.commentsForNode(this.session.document, node, content, annotations, scope);
  },

  // Based on a new set of annotations (during editing)
  updateAnnotations: function(content, annotations) {
    var node = this.session.node();

    // Only consider markers as comment scopes
    annotations = _.filter(annotations, function(a) {
      return _.include(["idea", "question", "error"], a.type);
    });

    this.commentsForNode(this.session.document, node, content, annotations);
  },

  commentsForNode: function(document, node, content, annotations, scope) {
    this.scopes = [];

    // Extract annotation text from the model
    function annotationText(a) {
      if (!a.pos) return "No pos";
      return content.substr(a.pos[0], a.pos[1]);
    }

    if (node) {
      this.scopes.push({
        name: "Node",
        type: "node",
        id: "node_comments",
        comments: document.find('comments', node)
      });

      _.each(annotations, function(a) {
        if (_.include(["idea", "question", "error"], a.type)) {
          this.scopes.push({
            name: annotationText(a),
            type: a.type,
            annotation: a.id,
            id: a.id,
            comments: document.find('comments', a.id)
          });
        }
      }, this);
    } else {
      // No document scopes for now
      // this.scopes.push({
      //   id: "document_comments",
      //   name: "Document",
      //   type: "document",
      //   comments: []
      // });
    }
    this.session.trigger('comments:updated', scope);
  }
});

root.Substance.Session = Session;

})(this);
