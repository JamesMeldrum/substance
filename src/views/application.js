(function(root) { "use_strict";

  // Import
  // ========

  var _ = root._;
  var Substance = root.Substance;
  var sc = root.sc;
  var key = root.key;

  // Implementation
  // ========

  // The Mothership
  // ---------------

  var Application = Substance.View.extend({
    events: {
      'submit #login_form': '_login',
      'submit #signup_form': '_signup',
      'click .logout': '_logout',
      'click #container': '_clear',
      'click #header .sync': '_sync',
      'click .toggle-user-actions': '_toggleUserActions',
      'click .toggle-environments': '_toggleEnvironments',
      'click a.load-environment': '_loadEnvironment',
      'click .user-actions': '_hideUserActions'
    },

    initialize: function() {
      this.session = this.model;

      _.bindAll(this, 'document', 'dashboard', 'login', 'signup',
                      'console', 'testsuite', 'replicationStart',
                      'replicationFinish');

      this.session.on('replication:started', this.replicationStart);
      this.session.on('replication:finished', this.replicationFinish);

      this.registerKeyBindings();
    },

    _toggleUserActions: function() {
      $('.user-actions').toggle();
      return false;
    },

    _hideUserActions: function() {
      $('.user-actions').hide();
    },

    _toggleEnvironments: function() {
      $('#header .environments').toggle();
      return false;
    },

    _loadEnvironment: function(e) {
      var env = $(e.currentTarget).attr('data-env');
      appSettings.setItem('env', env);
      Substance.initSession(env);
      this.dashboard();
    },

    _clear: function(e) {
      if (_.include(['container', 'tools', 'composer'], e.target.id) && this.view.composer) this.view.composer.clear();
    },

    // Synchronizing
    _sync: function() {
      this.session.replicate();
      return false;
    },

    _login: function() {
      var that = this,
          username = $('#login_username').val(),
          password = $('#login_password').val();

      this.session.authenticate(username, password, function(err) {
        if (err) {
          that.$('#login .error-message').html(err);
          return;
        }

        that.user = username;
        that.dashboard();
      });
      return false;
    },

    _signup: function() {
      var that = this,
          user = {
            name: $('#signup_name').val(),
            username: $('#signup_username').val(),
            email: $('#signup_email').val(),
            password: $('#signup_password').val()
          };

      this.session.createUser(user, function(err) {
        if (err) {
          that.$('#login .error-message').html(err);
          return;
        }

        that.user = user.username;
        that.dashboard();
      });

      return false;
    },

    _logout: function() {
      this.session.logout();
      this.render();

      // Show login screen
      this.login();
      return false;
    },

    replicationStart: function() {
      this.$('#header .sync').addClass('active').addClass('disabled');
    },

    replicationFinish: function(err) {
      var that = this;

      // UI update
      _.delay(function() {
        that.$('#header .sync').removeClass('active');
        
        // Update status
        if (err) this.$('#header .sync').removeClass('disabled').addClass('error');

        // only re-render after sync when on dashboard
        if (that.view instanceof sc.views.Dashboard) {
          that.render();
        }
      }, 500);
    },


    // Toggle document view
    document: function(id) {
      var that = this;
      this.session.loadDocument(id, function(err, doc) {

        if (that.view) that.view.dispose();
        that.view = new sc.views.Editor({ model: that.session });

        that.render();
        Substance.router.navigate('documents/'+that.session.document.id, false);

        // Shortcuts
        // window.doc = session.document;
        that.listenForDocumentChanges();
      });
      
      // this.render();
      // this.listenForDocumentChanges();
      // this.newDocument();
    },

    // Toggle document view
    console: function(id) {
      var that = this;

      Substance.session.loadDocument(id);

      // Shortcuts
      if (this.view) this.view.dispose();
      that.view = new sc.views.Console({model: Substance.session});
      that.render();
    },

    testsuite: function(test) {
      if (this.view) this.view.dispose();
      this.view = new sc.views.Testsuite();
      this.render();

      if (test) {
        this.view.runTest(test);
      }
      return;
    },

    // TODO: find a better way
    listenForDocumentChanges: function() {
      var that = this;
      var doc = this.view.model.document;

      doc.on('commit:applied', function(commit) {
        // Update publish state
        that.view.updatePublishState();
        if (commit.op[0] === "set") {
          var title = doc.properties.title;
          that.$('.menu .document').html(title);
        }
      });
    },

    // Create and edit a new document
    // ---------------

    newDocument: function() {
      var session = Substance.session;
      session.createDocument();
      if (this.view) this.view.dispose();
      this.view = new sc.views.Editor({ model: session });
      this.render();
      Substance.router.navigate('documents/'+session.document.id, false);

      // Shortcuts
      //window.doc = session.document;

      this.listenForDocumentChanges();
    },

    // User dashboard
    // ---------------

    dashboard: function(collection) {
      var that = this;

      if (!collection) collection = 'my_documents';
      
      if (!Substance.session.user()) return this.login();

      if (this.view) this.view.dispose();
      that.view = new sc.views.Dashboard({
        model: Substance.session.getDashboard(collection)
      });
      that.render();
      Substance.router.navigate('/dashboard/'+collection);

      return;
    },

    login: function() {
      if (this.view) this.view.dispose();
      this.view = new sc.views.Login();
      this.render();
    },

    signup: function() {
      if (this.view) this.view.dispose();
      this.view = new sc.views.Signup();
      this.render();
    },

    // Render application template
    render: function() {
      var document = null;
      if (this.view instanceof sc.views.Editor) {
        document = this.view.model.document.properties;
      }

      this.$el.html(_.tpl('substance', {
        user: Substance.session.user(),
        document: document
      }));

      if (this.view) {
        this.$('#container').replaceWith(this.view.render().el);
      }
    },

    registerKeyBindings: function() {

      // Selection Shortcuts
      // ----------

      key('down', _.bind(function(e) {
        this.trigger('message:select-next', e);
      }, this));

      key('up', _.bind(function(e) {
        this.trigger('message:select-previous', e);
      }, this));

      key('shift+down', _.bind(function(e) {
        this.trigger('message:expand-selection', e);
      }, this));

      key('shift+up', _.bind(function(e) {
        this.trigger('message:narrow-selection', e);
      }, this));

      key('esc', _.bind(function(e) {
        this.trigger('message:go-back', e);
      }, this));


      // Move Shortcuts
      // ----------

      key('alt+down', _.bind(function(e) {
        this.trigger('message:move-down', e);
      }, this));

      key('alt+up', _.bind(function(e) {
        this.trigger('message:move-up', e);
      }, this));

      // Handle enter (creates new paragraphs)
      key('enter', _.bind(function(e) {
        this.trigger('message:break-text', e);
      }, this));

      // Handle backspace
      key('backspace', _.bind(function(e) {
        this.trigger('message:delete-node', e);
      }, this));

      // Node insertion shortcuts
      key('alt+t', _.bind(function(e) {
        this.trigger('message:insert-node', e, 'text');
      }, this));

      key('alt+h', _.bind(function(e) {
        this.trigger('message:insert-node', e, 'heading');
      }, this));


      // Marker Shortcuts
      // ----------

      key('⌘+i', _.bind(function(e) {
        this.trigger('message:toggle-annotation', e, 'emphasis');
      }, this));

      key('⌘+b', _.bind(function(e) {
        this.trigger('message:toggle-annotation', e, 'strong');
      }, this));

      key('ctrl+1', _.bind(function(e) {
        this.trigger('message:toggle-annotation', e, 'idea');
      }, this));

      key('ctrl+2', _.bind(function(e) {
        this.trigger('message:toggle-annotation', e, 'question');
      }, this));

      key('ctrl+3', _.bind(function(e) {
        this.trigger('message:toggle-annotation', e, 'error');
      }, this));


      // Indent / Dedent Headings
      // ----------

      key('tab', _.bind(function(e) {
        this.trigger('message:indent', e);
      }, this));

      key('shift+tab', _.bind(function(e) {
        this.trigger('message:dedent', e);
      }, this));

      // Undo / Redo
      // ----------

      key('⌘+z', _.bind(function(e) {
        this.trigger('message:undo', e);
      }, this));

      key('shift+⌘+z', _.bind(function(e) {
        this.trigger('message:redo', e);
      }, this));

      // Other
      // --------

      // Trigger sync with hub
      key('ctrl+alt+s', _.bind(function() {
        this._sync();
        return false;
      }, this));

    }
  });

  // Export
  // ========

  Substance.Application = Application;

})(this);
