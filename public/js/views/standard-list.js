// --------------------------------------------------
// Editable list view
// --------------------------------------------------
define(function (require) {
	
	// dependencies
	var $ = require('jquery'),
		_ = require('underscore'),
		Backbone = require('backbone');
		
	// Bring in just enough jQuery UI for drag and drop
	require('decoy/plugins/jquery-ui-1.9.0.custom');
	
	// Bring in the template for new rows.  Currently, the only need to do this
	// is for many-to-many row insertion
	var row_template = _.template(require('decoy/text!decoy/templates/many-to-many-row.html'));
	
	// private static vars
	var app,
		dataId = 'data-model-id',
		visibleIconClass = 'icon-eye-open';

	// public view module
	var StandardList = Backbone.View.extend({
		
		initialize: function () {
			_.bindAll(this);
			app = this.options.app;

			// Get the path to the controller.  If this is not specified via a
			// data attribtue of "controller-route" then we attempt to infer it from
			// the current URL.
			this.controllerRoute = this.$el.data('controller-route');
			if (!this.controllerRoute) {
				this.controllerRoute = window.location.pathname;
			}
			
			// There may be a parent-id defined for many-to-many remove actions
			this.parent_id = this.$el.data('parent-id');
			
			// cache selectors
			this.$deleteBtn = this.$('.delete-selected');
			this.$deleteAlert = this.$('.delete-alert');
			this.$bulkActions = this.$('.bulk-actions');
			this.$total = this.$('legend .badge, h1 .badge');
			this.$trs = this.$el.find('[' + dataId + ']');
			
			// Create model collection from table rows.  The URL is fetched from
			// the controller-route data attribute of the container.
			this.rows = [];
			this.collection = new Backbone.Collection();
			this.collection.url = this.controllerRoute;
			_.each(this.$trs, this.initRow);
			
			// listen for collection changes and render view
			this.collection.on('change', this.render, this);
			this.collection.on('change:featured', this.updateFeatured, this);
			
			// Add drag and drop if there is position data on the first
			// row.  It expects the current position of the a row to be stored
			// as a data value on the row
			if (this.$trs.first().data('position') !== undefined) {
				this.$sortContainer = this.initSortable();
			}
		},
		
		initRow: function (row) {
			
			// Find vars
			var $row = $(row),
				modelId = $row.attr(dataId),
				$inputs = $row.find('input'),
				featured = $inputs.filter('[name=set-featured]').prop('checked'),
				$visibility = $row.find('.visibility'),
				visible_state = $visibility.find('.'+visibleIconClass).length > 0,
				position = $row.data('position');
			
			// Define the model data
			var data = {
				id: modelId,
				selected: false,
				featured: featured,
				position: position
			};
			
			// If this item supports visibility, add it to the model
			if ($visibility.length) {
				data.visible = visible_state;
			}
			
			// Create the model and store a reference
			var model = new Backbone.Model(data);
			model.whitelist = ['position']; // Only sync position
			if ($visibility.length) model.whitelist.push('visible');

			// Add the model to the collection
			this.collection.push(model);
			$inputs.data('model', model);
			this.rows.push($row);

			// reset checkboxes on reload (for Firefox)
			$inputs.filter('[name=select-row]').prop('checked', false);
		},
		
		// Turn on sortability
		initSortable: function() {
			
			// Cache some selectors
			var $sortable = this.$el.find('tbody');
			
			// Tell the server of the new sorting rules by looping through
			// all rows, looking up the model for the id, and then updating
			// it's position attribute.
			var update = function(event, ui) {
				var id,
					$sortableRows = $sortable.find('[' + dataId + ']');
				_.each($sortableRows, function(el, i) {
					id = $(el).attr(dataId);
					this.collection.get(id).set({position: i});
				}, this);
			};
			
			// When update gets called, make sure that "this" is the
			// backbone view.
			update = _.bind(update, this);
			
			// Define options
			var options = {
				tolerance: 'pointer',
				revert: 100,
				containment: $sortable,
				toleranceType: 'pointer',
				
				// Create the placeholder with the right column span
				// http://stackoverflow.com/a/8707306
				placeholder: 'placeholder',
				forcePlaceholderSize: true,
				start: function(event, ui) {
					ui.placeholder.html("<td colspan='999'></td>");
					
					// For some reason, this always gets created 1px to tall.
					ui.placeholder.height(ui.placeholder.height()-1);
				},

				// Preserve the widths of columns during dragging
				// From http://cl.ly/170d0h291V10
				helper: function(e, tr) {
					var $originals = tr.children();
					var $helper = tr.clone();
					$helper.addClass('helper');
					$helper.children().each(function(index) {
						$(this).width($originals.eq(index).width());
					});
					return $helper;
				},
				
				// Callback function after sorting happens.
				update: update
			};
			
			// Turn on sorting
			$sortable.sortable(options).disableSelection();
			
			// Listen for changes and persist them to the server
			this.collection.on('change:position', function(model, position) {
				model.save();
			}, this);
			
			// Return a reference to the sortable item
			return $sortable;
		},
		
		events: {
			'click .select-all': 'toggleAll',
			'click .delete-selected': 'deleteSelected',
			'click .remove-confirm': 'removeConfirm',
			'click .delete-confirm': 'deleteConfirm',
			'click .delete-cancel': 'deleteCancel',
			'click input[name=select-row]': 'toggleSelect',
			'click input[name=set-featured]': 'setFeatured',
			'click .delete-now': 'deleteNow',
			'click .remove-now': 'removeNow',
			'click .visibility': 'toggleVisibility',
			'insert': 'insertNew'
		},
		
		// Delete the row via JS
		deleteNow: function(e) {
			e.preventDefault();
			
			// Find the model
			var $row = $(e.target).closest('tr'),
				modelId = $row.attr(dataId),
				model = this.collection.get(modelId);
			
			// Hide while waiting
			if ($row.data('deleting')) return;
			$row.data('deleting', true);
			$row.animate({opacity:0.2}, 100);
			
			// Delete it
			model.destroy({
				
				// Fade out on success
				success: _.bind(function() {
					this.hideRow($row);
					
					// Decrement the counter
					this.$total.text(parseInt(this.$total.first().text(),10) - 1);
					
				},this),
				
				// Show error on failure
				error:function() {
					$row.animate({opacity:1}, 300);
					$row.data('deleting', false);
				}
			});
		},
		
		// Remove the pivot row via JS
		removeNow: function(e) {
			e.preventDefault();
		
			// Find the model
			var $a = $(e.target).closest('a'),
				href = $a.attr('href'),
				$row = $a.closest('tr'),
				modelId = $row.attr(dataId);
				
			// Hide while waiting
			if ($row.data('removing')) return;
			$row.data('removing', true);
			$row.animate({opacity:0.2}, 100);
			
			// Call the remove route
			$.ajax(this.controllerRoute+'/remove/'+modelId, {
				type: 'DELETE',
				dataType: 'JSON'
			})
			
			// Fade out on success
			.done(_.bind(function() {
				this.hideRow($row);
				
				// Decrement the counter
				this.$total.text(parseInt(this.$total.first().text(),10) - 1);
			}, this))
			
			// Show error on failure
			.fail(function() {
				$row.animate({opacity:1}, 300);
				$row.data('removing', false);
			});
		},
		
		// Hide a row, a in a delete
		hideRow: function($row) {
			$row.find('td').each(function() {
				
				// Animate out the padding of the cells
				$(this).animate({paddingTop: 0, paddingBottom:0}, 300);
				
				// Add a div inside the cell and animate the hight going to 0 if it
				// (since we can't aniamte the row itself)
				$(this).wrapInner("<div/>").children("div").animate({height: 0}, 300, function() {
					$row.hide();
				});
			});
		},
		
		toggleAll: function () {
			var anyFalse = this.collection.where({ selected: false }).length;
			this.collection.invoke('set', 'selected', anyFalse ? true : false);
		},
		
		deleteSelected: function () {
			this.$deleteAlert.removeClass('hide');
			this.render();
		},
		
		// Delete rows using ajax.  Using a dash
		// as the delimiter because other options, like a comma, didn't
		// work with laravel.
		deleteConfirm: function () {
			
			// Vars
			var models = this.collection.where({ selected: true }),
				ids = _.pluck(models, 'id'),
				$rows = this.findRows(ids);
			
			// Hide while waiting
			_.each($rows, function($row) {
				if ($row.data('deleting')) return;
				$row.data('deleting', true);
				$row.animate({opacity:0.2}, 100);
			}, this);
			
			// Delete them
			_.each(models, function(model, i) {
				model.destroy({
					
					// Fade out on success
					success: _.bind(function() {
						
						// Update the editable list controls
						this.render();
						
						// The delay is so it happens after the controls disapear
						var $row = this.findRows(model.id)[0];
						_.delay(this.hideRow, i*100 + 300, $row);
						
						// Decrement the counter
						this.$total.text(parseInt(this.$total.first().text(),10) - 1);
						
					},this),
					
					// Show error on failure
					error:function() {
						_.each($rows, function($row) {
							$row.animate({opacity:1}, 300);
							$row.data('deleting', false);
						}, this);
					}
				});
			}, this);
	
		},
		
		// Remove a many-to-many relationship.  This should be dried up so we're just changing
		// statuses on the model and it's handling the presentation.
		removeConfirm: function() {
			
			// ID in this case is actually the pivot_id, which has been put into
			// the data-model-id attribute
			var ids = _.pluck(this.collection.where({ selected: true }), 'id'),
				$rows = this.findRows(ids),
				url = this.controllerRoute+'/remove/'+ids.join('-');
			
			// Hide while waiting
			_.each($rows, function($row) {
				if ($row.data('removing')) return;
				$row.data('removing', true);
				$row.animate({opacity:0.2}, 100);
			}, this);
			
			// Call the bulk remove route
			$.ajax(url, {
				type: 'DELETE',
				dataType: 'JSON'
			})
			
			// Fade out on success
			.done(_.bind(function() {
				
				// Remove the models from the collection
				this.collection.remove(this.collection.where({ selected: true }));
				this.render();
				
				// Hide all the rows.  The delay is so it happens after the controls disapear
				_.each($rows, function($row, i) {
					_.delay(this.hideRow, i*100 + 300, $row);
				}, this);
				
				// Decrement the counter
				this.$total.text(parseInt(this.$total.first().text(),10) - ids.length);
			}, this))
			
			// Show error on failure
			.fail(function() {
				_.each($rows, function($row) {
					$rows.animate({opacity:1}, 300);
					$rows.data('removing', false);
				}, this);
			});
			
		},
		
		// Get all of the DOM elements as jquery elements that have the passed ids
		findRows: function(ids) {
			if (!_.isArray(ids)) ids = [ids];
			return _.filter(this.rows, function($row) {
				return _.contains(ids, $row.attr(dataId));
			}, this);
		},
		
		deleteCancel: function () {
			this.$deleteAlert.addClass('hide');
			this.render();
		},
		
		toggleSelect: function (e) {
			var model = $(e.target).data('model');
			model.set('selected', !model.get('selected'));
		},
		
		setFeatured: function (e) {
			var model = $(e.target).data('model');
			model.set('featured', true);
		},
		
		// Toggle the visibility of the model
		toggleVisibility: function(e) {
			e.preventDefault();
			
			// Find the model
			var $row = $(e.target).closest('tr'),
				modelId = $row.attr(dataId),
				model = this.collection.get(modelId);
				
			// Set the visibility status
			model.set('visible', model.get('visible') ? false : true);
			model.save();
			
			// Update the UI
			this.render(model);
			
		},
		
		// update featured state and deal with server request
		updateFeatured: function (model) {
			// tell other models to not be featured
			var others = this.collection.without(model);
			_.invoke(others, 'set', 'featured', false, { silent: true });
			// gather model data for backend request
			var output = _.map(this.collection.models, function (model) {
				return model.get('id') + ':' + model.get('featured');
			});
			window.console.log('TODO: tell backend about featured', output);
		},
		
		// Insert a new row into the list.  This may be triggered by many-to-many
		insertNew: function(e, data) {
			
			// Build the row.  Note, the id must be unique for each row.  This means
			// that we can't insert multiple rows for the same join or the bulk
			// actions won't work
			var $row = $(row_template({
				id: data.id,
				pivot_id: data.pivot_id,
				label: data.label,
				controller: this.controllerRoute
			}));
			
			// Add the template to the list, above the first row with a model id.  Or
			// if there are no results, replace the last row, which will be the
			// 'no results found' message
			var $caret = this.$('tbody ['+dataId+']').first();
			if ($caret.length) $caret.before($row);
			else this.$('tbody tr').last().replaceWith($row);
			
			// Add the backbone brains (it's not expecting a jquery object)
			this.initRow($row[0]);
			
			// Increment the counter
			this.$total.text(parseInt(this.$total.first().text(),10) + 1);
			
			// Enable tooltips
			this.$el.find('.js-tooltip').tooltip({ animation: false });
			
			// Fade it in
			$row.hide().fadeIn();
			
		},
		
		// render view from model changes
		render: function (model) {

			// if there's a model, iterate through row elements using model id and make the
			// checkbox checked if the model thinks it should be
			model && _.each(this.rows, function ($row) {
				if ($row.attr(dataId) !== model.get('id')) return;
				$row.find('input[name=select-row]').prop('checked', model.get('selected'));
			});
			
			// Update the visibilty state
			if (model && model.has('visible')) {
				var $row = this.findRows(model.id)[0],
					$icon = $row.find('.visibility i');

				// Toggle icon
				if (model.get('visible')) {
					$icon.removeClass('icon-').addClass(visibleIconClass);
					$icon.attr('title', 'Make hidden');
				} else {
					$icon.removeClass(visibleIconClass).addClass('icon-');
					$icon.attr('title', 'Make visible');
				}
			}
			
			// Update the disabled state of the delete/remove buttons
			var anySelected = this.collection.where({ selected: true }).length,
				enableDelete = anySelected && (!this.$deleteAlert.length || this.$deleteAlert.hasClass('hide'));
			if (enableDelete) {
				this.$deleteBtn.removeClass('disabled');
				this.$bulkActions.removeClass('hide');
			} else {
				this.$deleteBtn.addClass('disabled');
				this.$bulkActions.addClass('hide');
			}
			
			// Toggle the sortability
			if (this.$sortContainer) {
				if (anySelected) this.$sortContainer.sortable('disable');
				else this.$sortContainer.sortable('enable');
			}
			
			// Hide the alert if none are selected
			if (!anySelected) this.$deleteAlert.addClass('hide');
		}
	});
	
	return StandardList;
});