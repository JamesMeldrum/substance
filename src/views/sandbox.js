"use strict";

var _ = require("underscore");
var util = require('substance-util');
var html = util.html;
var Substance = require("../substance");
var View = Substance.Application.View;
var TestCenter = Substance.Test.TestCenter;
var EditorView = require("./editor");


// SandboxView Constructor
// ==========================================================================

var SandboxView = function(controller) {
  View.call(this);

  this.controller = controller;

  // Handle state transitions
  // --------
  this.listenTo(this.controller, 'state-changed', this.onStateChanged);

  // DOM events
  // -----------

  // this.$el.delegate(".action.logout", "click", _.bind(this.logout, this));
};

SandboxView.Prototype = function() {

  // Session Event handlers
  // ==========================================================================
  //

  this.onStateChanged = function(newState, oldState, options) {
    if (newState === "editor") {
      this.openEditor();
    } else if (newState === "test_center") {
      this.openTestCenter(options);
    } else {
      console.log("Unknown application state: " + newState);
    }
  };

  // Open Editor
  // ----------
  //

  this.openEditor = function() {
    // Application controller has a editor controller ready
    // -> pass it to the editor view
    var view = new EditorView(this.controller.editor);
    this.replaceMainView('editor', view);
  };

  // Open TestCenter
  // ----------
  //

  this.openTestCenter = function(options) {
    var view = new TestCenter(this.controller.testRunner, options);
    this.replaceMainView('test_center', view);
  };


  // Rendering
  // ==========================================================================
  //

  this.replaceMainView = function(name, view) {
    $('body').removeClass().addClass('current-view '+name);

    if (this.mainView) {
      this.mainView.dispose();
    }

    this.mainView = view;
    this.$('#container').html(view.render().el);
  };

  this.render = function() {
    this.$el.html(html.tpl('substance', this.controller.session));
    return this;
  };
};


// Export
// --------

SandboxView.Prototype.prototype = View.prototype;
SandboxView.prototype = new SandboxView.Prototype();

module.exports = SandboxView;
