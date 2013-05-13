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

    if (node) {
      var nodeData = this.session.document.nodes[node];
      var content = nodeData.content;
      var annotations = this.session.document.find('annotations', node);
    }
    this.commentsForNode(this.session.document, node, content, annotations, scope);
  },

  // Based on a new set of annotations (during editing)
  updateAnnotations: function(content, annotations) {
    var node = this.session.node();

    // Only consider markers as comment scopes
    var annotations = _.filter(annotations, function(a) {
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

// Substance.Session
// -----------------
//
// The Composer works with a session object, which maintains
// all the state of a document session
// TODO: No multiuser support yet, use app.user

Substance.Session = function(options) {
  var that = this;
  this.env = options.env;

  this.lazySync = _.debounce(function() {
    if (!this.pendingSync) return;
    this.replicate();
  }, 4000);
  this.initStores();
};

_.extend(Substance.Session.prototype, _.Events, {

  initStores: function() {
    var username = this.user();
    var token = this.token();
    var config = Substance.config();

    this.client = new Substance.Client({
      "hub_api": config.hub_api,
      "client_id": config.client_id,
      "client_secret": config.client_secret,
      "token": token
    });

    if (username) {
      if (Substance.client_type === "native") {
        this.localStore = new Substance.RedisStore({
          scope: this.env+":"+username
        });
        // Assumes client instance is authenticated
        this.remoteStore = new Substance.RemoteStore({
          client: this.client
        });
      } else {
        this.localStore = new Substance.RemoteStore({
          client: this.client
        });
        this.remoteStore = null;
      }
    }
  },

  // When a doc changes, bind event handlers etc.
  initDoc: function() {
    var that = this;
    this.selections = {};

    // Comments view
    this.comments = new Substance.Comments(this);

    // Register user
    this.users = {};
    this.users[this.user()] = {
      "color": "#2F2B26",
      "selection": []
    };
  },

  // Create a new document locally
  // Schema is optional (currently only used by testsuite)
  createDocument: function(cb, schema) {
    var id = Substance.util.uuid();
    var that = this;

    var cid = Substance.util.uuid();

    var meta = {
      "creator": that.user(),
      "title": "Untitled",
      "abstract": "Enter abstract"
    };

    var c1 = {
      "op": ["set", {title: meta.title, abstract: meta.abstract}],
      "sha": cid,
      "parent": null
    };

    var refs = {"master": {"head": cid, "last": cid}};

    var doc = {
      "id": id,
      "meta": meta,
      "commits": {},
      "refs": refs
    };

    doc.commits[cid] = c1;

    this.localStore.create(id, {meta: meta, commits: [c1], refs: refs}, function(err) {
      if (err) return cb(err);
      that.document = new Substance.Session.Document(that, doc, schema);
      that.initDoc();
      cb(null, that.document);
    });
  },

  getBlob: function(docId, blobId, cb) {
    return this.localStore.getBlob(docId, blobId, cb);
  },

  createBlob: function(docId, blobId, data, cb) {
    return this.localStore.createBlob(docId, blobId, data, cb);
  },

  deleteBlob: function(docId, blobId, cb) {
    return this.localStore.deleteBlob(docId, blobId, cb);
  },

  // Load new Document from localStore
  loadDocument: function(id, cb) {
    var that = this;
    this.localStore.get(id, function(err, doc) {
      if (err) return cb(err);
      that.document = new Substance.Session.Document(that, doc);
      that.initDoc();
      cb(err, that.document);
    });
  },

  // Update local document
  updateDocument: function(options, cb) {
    this.localStore.update(this.document.id, options, cb);
  },

  // Update meta info of current document
  updateMeta: function(cb) {
    // Triggers a sync with remote store if available
    this.pendingSync = true;
    this.lazySync();

    var doc = this.document;
    _.extend(doc.meta, doc.properties);
    doc.meta.updated_at = new Date();
  },

  deleteDocument: function(id, cb) {
    this.localStore.delete(id, cb);
  },

  // Replicate local docstore with remote docstore
  replicate: function(cb) {
    var that = this;
    this.pendingSync = false;

    var replicator = new Substance.Replicator({
      user: this.user(),
      localStore: this.localStore,
      remoteStore: this.remoteStore
    });

    this.trigger('replication:started');

    replicator.sync(function(err) {
      that.trigger('replication:finished', err);
      if (cb) cb(err);
    });
  },

  // Select a document
  // Triggers re-render of comments panel etc.
  select: function(nodes, options) {

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
  },

  createPublication: function(network, cb) {
    var doc = this.document;
    var that = this;

    this.client.createPublication(doc.id, network, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  },

  deletePublication: function(id, cb) {
    var that = this;
    var doc = this.document;
    this.client.deletePublication(id, function(err) {
      if (err) return cb(err);
      that.loadPublications(cb);
    });
  },

  createVersion: function(cb) {
    var doc = this.document;
    var that = this;
    var data = doc.toJSON(true); // includes indexes

    var blobs = {};

    // Push document cover?
    if (doc.properties.cover_medium) {
      blobs[doc.properties.cover_medium] = that.getBlob(doc.id, doc.properties.cover_medium);
      blobs[doc.properties.cover_large] = that.getBlob(doc.id, doc.properties.cover_large);
    }

    // Find all images
    _.each(doc.nodes, function(node) {
      if (node.type === "image") {
        blobs[node.medium] = that.getBlob(doc.id, node.medium);
        blobs[node.large] = that.getBlob(doc.id, node.large);
      }
    });

    // Attach blob data to body
    data.blobs = blobs;

    // Now create version on the server
    that.client.createVersion(doc.id, data, function(err) {
      if (err) return cb(err);
      doc.meta.published_at = new Date();
      doc.meta.published_commit = doc.getRef('head');

      that.updateMeta(function() {
        that.loadPublications(cb);
      });
    });
  },

  // Unpublish document
  unpublish: function(cb) {
    var doc = this.document;
    var that = this;
    this.client.unpublish(doc.id, function(err) {
      if (err) return cb(err);
      delete doc.meta["published_at"];
      delete doc.meta["published_commit"];
      that.updateMeta(cb)
    });
  },

  // Retrieve current publish state
  publishState: function() {
    var doc = this.document;
    if (!doc.meta.published_commit) return "unpublished";
    if (doc.getRef('head') === doc.meta.published_commit) return "published";
    return "dirty";
  },

  // Checks if selection has actually changed for a user
  selectionChanged: function(user, nodes, edit) {
    // this.edit remembers the previous selection/edit state
    return !_.isEqual(nodes, this.selection(user)) || edit !== this.edit;
  },

  // Retrieve current node selection
  selection: function(user) {
    if (!user) user = this.user();
    return this.users[user].selection;
  },

  // Returns the node id of current active node
  // Only works if there's just one node selected
  node: function() {
    var lvl = this.level(),
        sel = this.selection();

    if (lvl >= 2 && sel.length === 1) {
      return sel[0];
    }
  },

  // Returns current navigation level (1..3)
  level: function() {
    var selection = this.users[this.user()].selection;

    // Edit mode
    if (this.edit) return 3;

    // Selection mode (one or more nodes)
    if (selection.length >= 1) return 2;

    // no selection -> document level
    return 1;
  },

  // Load Publish state
  loadPublications: function(cb) {
    var doc = this.document;
    var that = this;

    this.client.listNetworks(function(err, networks) {
      if (err) return cb(err);
      that.networks = networks; // all networks
      that.client.listPublications(doc.id, function(err, publications) {
        that.publications = publications;
        _.each(that.publications, function(p) {
          // Attach network information
          p.network = _.find(that.networks, function(n) { return n.id === p.network; });
        });
        cb(null);
      });
    });
  },

  // Load Collaborators for current document
  loadCollaborators: function(cb) {
    var doc = this.document;
    var that = this;
    this.client.listCollaborators(doc.id, function(err, collaborators) {
      //console.log('client.loadCollaborators: collaborators', collaborators);
      that.collaborators = collaborators;
      cb(null);
    });
  },

  // Create new collaborator on the server
  createCollaborator: function(collaborator, cb) {
    var doc = this.document;
    var that = this;
    this.client.createCollaborator(doc.id, collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  },

  // Delete collaborator on the server
  deleteCollaborator: function(collaborator, cb) {
    var doc = this.document;
    var that = this;
    this.client.deleteCollaborator(collaborator, function(err) {
      if (err) return cb(err);
      that.loadCollaborators(cb);
    });
  },

  setProperty: function(key, val) {
    appSettings.setItem(this.env+":"+key, val);
  },

  getProperty: function(key) {
    return appSettings.getItem(this.env+":"+key);
  },

  user: function() {
    return this.getProperty('user') || "";
  },

  token: function() {
    return this.getProperty('api-token') || "";
  },

  // Authenticate session
  authenticate: function(username, password, cb) {
    var that = this;
    this.client.authenticate(username, password, function(err, data) {
      if (err) return cb(err);
      that.setProperty('user', username);
      that.setProperty('api-token', data.token);

      that.initStores();
      cb(null, data);
    });
  },

  logout: function() {
    this.localStore = null;
    this.remoteStore = null;
    this.setProperty('user', '');
    this.setProperty('api-token', '');
  },

  authenticated: function() {
    return !!this.getProperty("user");
  },

  // Create a new user on the server
  createUser: function(user, cb) {
    this.client.createUser(user, cb);
  },

  listDocuments: function(cb) {
    if (!this.localStore) return cb(null, []);
    this.localStore.list(function(err, documents) {
      var res = _.map(documents, function(doc) {
        return {
          title: doc.meta.title,
          author: "le_author",
          file: doc.id,
          id: doc.id,
          meta: doc.meta,
          updated_at: doc.meta.updated_at
        };
      });
      cb(null, res);
    });
  }
});

Substance.Session.Document = function(session, document, schema) {
  var self = this;

  Substance.Document.call(this, document, schema);

  var proto = Substance.util.prototype(this);

  // override apply and setRef to let Session stay in control
  // Adapter that persists the change before updating the model
  this.apply = function(operation, options, cb) {
    // options as well as callback is optional
    if(arguments.length == 2) {
      if (_.isFunction(options)) {
        cb = options;
        options = null;
      }
    }

    options = options || {};

    // apply the operation to the document (Substance.Document.apply)
    // without triggering events
    var commit = proto.apply.call(self, operation, _.extend({"silent": true}, options));

    if (!options['no-commit']) {

      session.updateMeta();

      var options = {
        "refs": {
          "master": {
            "head": commit.sha,
            "last": commit.sha
          }
        },
        meta: session.document.meta,
        commits: [commit]
      };

      return session.updateDocument(options, function(err) {
        if (!options.silent) self.trigger('commit:applied', commit);
        if (cb) cb(err);
      });
    } else if (!options['silent']) {
      self.trigger('commit:applied', commit);
      if (cb) return cb(null);
    }

    if (cb) cb(null);
  };

  // adapter that persists the new ref before triggering
  this.setRef = function(ref, sha, silent, cb) {
    if (arguments.length === 3) {
      if (_.isFunction(silent)) {
        cb = silent;
        silent = false;
      }
    }

    // Do the thing
    proto.setRef.call(self, ref, sha, true);

    if (!silent) {
      var refs = {};
      refs[ref] = sha;
      var options = {refs: {"master": refs}};

      session.updateMeta();
      options.meta = session.document.meta;

      session.localStore.update(self.id, options, function(err) {        
        self.trigger('ref:updated', ref, sha);
        if(cb) cb(err);
      });
    } else {
      if (cb) cb(null);
    }
  };
}

// inherit the prototype of Substance.Document which extends util.Events
Substance.Session.Document.prototype = Substance.Document.prototype;
