import Ember from 'ember';
import InboundActionsMixin from 'ember-component-inbound-actions/inbound-actions';
import DomMixin from 'ember-lifeline/mixins/dom';
import layout from '../templates/components/ember-scrollable';
import { Horizontal, Vertical } from '../classes/scrollable';

const {
  computed,
  deprecate,
  isPresent,
  inject: {
    service
  },
  run: {
    scheduleOnce,
    debounce,
    throttle
  }
} = Ember;

const hideDelay = Ember.testing ? 16 : 1000;
const PAGE_JUMP_MULTIPLE = 7 / 8;

const THROTTLE_TIME_LESS_THAN_60_FPS_IN_MS = 1; // 60 fps -> 1 sec / 60 = 16ms

const scrollbarSelector = '.tse-scrollbar';
const contentSelector = '.tse-content';

export default Ember.Component.extend(InboundActionsMixin, DomMixin, {
  layout,
  classNameBindings: [':ember-scrollable', ':tse-scrollable', 'horizontal', 'vertical'],

  /**
   * If true, a scrollbar will be shown horizontally
   *
   * @property horizontal
   * @public
   * @type Boolean
   * @default false
   */
  horizontal: null,

  /**
   * If true, a scrollbar will be shown vertically
   *
   * @property vertical
   * @public
   * @type Boolean
   */
  vertical: null,
  /**
   * Indicates whether the scrollbar should auto hide after a given period of time (see hideDelay),
   * or remain persitent alongside the content to be scrolled.
   *
   * @property autoHide
   * @public
   * @type Boolean
   * @default true
   */
  autoHide: true,
  scrollBuffer: 50,
  /**
   * Number indicating offset from anchor point (top for vertical, left for horizontal) where the scroll handle
   * should be rendered.
   *
   * @property scrollTo
   * @public
   * @type Number
   */
  scrollTo: computed('vertical', {
    get() {
      return this.get('vertical') ? this.get('scrollToY') : this.get('scrollToX');
    },
    set(key, value) {
      // TODO this is deprecated. remove eventually.
      deprecate('Using the `scrollTo` property directly has been deprecated, please prefer being explicit by using `scrollToX` and `scrollToY`.');
      const prop = this.get('vertical') ? 'scrollToY' : 'scrollToX';
      this.set(prop, value);
      return value;
    }
  }),

  /**
   * Position in pixels for which to scroll horizontal scrollbar.
   *
   * @property scrollToX
   * @public
   * @type Number
   */
  scrollToX: 0,
  /**
   * Position in pixels for which to scroll vertical scrollbar.
   *
   * @property scrollToY
   * @public
   * @type Number
   */
  scrollToY: 0,

  /**
   * Callback when the content is scrolled horizontally.
   *
   * @method onScrollX
   * @public
   * @type Function
   */
  onScrollX() {},

  /**
   * Callback when the content is scrolled vertically.
   *
   * @method onScrollY
   * @public
   * @type Function
   */
  onScrollY() {},

  /**
   * Local reference the horizontal scrollbar.
   *
   * @property horizontalScrollbar
   * @private
   */
  horizontalScrollbar: null,
  /**
   * Local reference the vertical scrollbar.
   *
   * @property verticalScrollbar
   * @private
   */
  verticalScrollbar: null,

  scrollbarThickness: service(),

  didReceiveAttrs() {
    const horizontal = this.get('horizontal');
    const vertical = this.get('horizontal');
    // Keep backwards compatible functionality wherein vertical is default when neither vertical or horizontal are explicitly set
    if (!horizontal && !isPresent(vertical)) {
      this.set('vertical', true);
    }
  },

  didInsertElement() {
    this._super(...arguments);
    this.setupElements();
    scheduleOnce('afterRender', this, this.createScrollbarAndShowIfNecessary);
    this.addEventListener(window, 'mouseup', (e) => this.endDrag(e));
    this.addEventListener(window, 'mousemove', (e) => {
      throttle(this, this.updateMouseOffset, e, THROTTLE_TIME_LESS_THAN_60_FPS_IN_MS);
    });
    this.setupResize();
  },

  willDestroyElement() {
    this._super(...arguments);

    this.$().off('transitionend webkitTransitionEnd', this._resizeHandler);
  },


  /**
   * Inidcates that the horizontal scrollbar is dragging at this moment in time.
   * @property isHorizontalDragging
   * @private
   */
  isHorizontalDragging: false,
  /**
   * Inidcates that the vertical scrollbar is dragging at this moment in time.
   * @property isVerticalDragging
   * @private
   */
  isVerticalDragging: false,
  /**
   * Size in pixels of the handle within the horizontal scrollbar.
   * Determined by a ration between the scroll content and the scroll viewport
   *
   * @property horizontalHandleSize
   * @private
   */
  horizontalHandleSize: null,
  /**
   * Size in pixels of the handle within the vertical scrollbar.
   * Determined by a ration between the scroll content and the scroll viewport
   *
   * @property verticalHandleSize
   * @private
   */
  verticalHandleSize: null,
  /**
   * Amount in pixels offset from the anchor (leftmost point of horizontal scrollbar)
   *
   * @property horizontalHandleOffset
   * @private
   */
  horizontalHandleOffset: 0,
  /**
   * Amount in pixels offset from the anchor (topmost point of vertical scrollbar)
   *
   * @property verticalHandleOffest
   * @private
   */
  verticalHandleOffest: 0,
  /**
   *
   * @property dragOffset
   * @private
   */
  dragOffset: 0,
  /**
   * Horizontal offset in pixels from the boundary of the scrollable container to the mouse.
   *
   * @property horizontalMouseOffset
   * @private
   * @type Number
   */
  horizontalMouseOffset: 0,
  /**
   * Vertical offset in pixels from the boundary of the scrollable container to the mouse.
   *
   * @property verticalMouseOffset
   * @private
   * @type Number
   */
  verticalMouseOffset: 0,

  contentSize(sizeAttr) {
    return this._contentElement[sizeAttr]();
  },

  setupElements() {
    this._contentElement = this.$(`${contentSelector}:first`);
  },

  /**
   * Used to create/reset scrollbar(s) if they are necessary
   *
   * @method createScrollbarAndShowIfNecessary
   */
  createScrollbarAndShowIfNecessary() {
    this.createScrollbar().map((scrollbar) => {
      this.checkScrolledToBottom(scrollbar);
      if (scrollbar.isNecessary) {
        this.showScrollbar();
      }
    });
  },

  _resizeHandler() {
    debounce(this, this.resizeScrollbar, 16);
  },

  setupResize() {
    this.addEventListener(window, 'resize', this._resizeHandler, true);
  },

  resizeScrollContent() {
    const width = this.$().width();
    const height = this.$().height();
    const scrollbarThickness = this.get('scrollbarThickness.thickness');

    const hasHorizontal = this.get('horizontal');
    const hasVertical = this.get('vertical');

    if (hasHorizontal && hasVertical) {
      this.set('scrollContentWidth', width + scrollbarThickness);
      this.set('scrollContentHeight', height + scrollbarThickness);
    } else if (hasHorizontal) {
      this.set('scrollContentWidth', width);
      this.set('scrollContentHeight', height + scrollbarThickness);
      this._contentElement.height(height);
    } else {
      this.set('scrollContentWidth', width + scrollbarThickness);
      this.set('scrollContentHeight', height);
    }
  },

  /**
   * Creates the corresponding scrollbar(s) from the configured `vertical` and `horizontal` properties
   *
   * @method createScrollbar
   * @return {Array} Scrollbar(s) that were created
   */
  createScrollbar() {
    if (this.get('isDestroyed')) {
      return [];
    }
    const scrollbars = [];

    this.resizeScrollContent();

    if (this.get('vertical')) {
      const verticalScrollbar = new Vertical({
        scrollbarElement: this.$(`${scrollbarSelector}.vertical`),
        contentElement: this._contentElement
      });
      this.set('verticalScrollbar', verticalScrollbar);
      this.updateScrollbarAndSetupProperties(0, 'vertical');
      scrollbars.push(verticalScrollbar);
    }
    if (this.get('horizontal')) {
      const horizontalScrollbar = new Horizontal({
        scrollbarElement: this.$(`${scrollbarSelector}.horizontal`),
        contentElement: this._contentElement
      });
      this.set('horizontalScrollbar', horizontalScrollbar);
      this.updateScrollbarAndSetupProperties(0, 'horizontal');
      scrollbars.push(horizontalScrollbar);
    }
    return scrollbars;
  },

  /**
   * Show the scrollbar(s) when the user moves within the scroll viewport
   *
   * @method mouseMove
   * @private
   */
  mouseMove() {
    if (this.get('autoHide')) {
      throttle(this, this.showScrollbar, THROTTLE_TIME_LESS_THAN_60_FPS_IN_MS);
    }
  },

  /**
   * Callback for the mouse move event. Update the mouse offsets given the new mouse position.
   *
   * @method updateMouseOffset
   * @param e
   * @private
   */
  updateMouseOffset(e) {
    const { pageX, pageY } = e;
    this.set('horizontalMouseOffset', pageX);
    this.set('verticalMouseOffset', pageY);
  },

  /**
   * Called on mouse up to indicate dragging is over.
   *
   * @method endDrag
   * @param e
   * @private
   */

  endDrag(e) {
    /* jshint unused:vars */
    this.set('isVerticalDragging', false);
    this.set('isHorizontalDragging', false);
  },

  /**
   * Calculates and setups the correct handle position using the scrollbar offset and size
   *
   * @method updateScrollbarAndSetupProperties
   * @param scrollOffset
   * @param scrollbarDirection
   * @private
   */
  updateScrollbarAndSetupProperties(scrollOffset, scrollbarDirection) {
    const { handleOffset, handleSize } = this.get(`${scrollbarDirection}Scrollbar`).getHandlePositionAndSize(scrollOffset);
    this.set(`${scrollbarDirection}HandleOffset`, handleOffset);
    this.set(`${scrollbarDirection}HandleSize`, handleSize);
  },

  /**
   * Callback for the scroll event emitted by the container of the content that can scroll.
   * Here we update the scrollbar to reflect the scrolled position.
   *
   * @method scrolled
   * @param event
   * @param scrollOffset
   * @param scrollDirection 'vertical' or 'horizontal'
   * @private
   */
  scrolled(event, scrollOffset, scrollDirection) {
    this.updateScrollbarAndSetupProperties(scrollOffset, scrollDirection);
    this.showScrollbar();

    this.checkScrolledToBottom(this.get(`${scrollDirection}Scrollbar`), scrollOffset);
    const direction = scrollDirection === 'vertical' ? 'Y' : 'X';
    this.get(`onScroll${direction}`)(scrollOffset);
    // synchronize scrollToX / scrollToY
    this.set(`scrollTo${direction}`, scrollOffset);
    // TODO this is deprecated. remove eventually.
    this.sendScroll(event, scrollOffset);
  },


  checkScrolledToBottom(scrollbar, scrollOffset) {
    let scrollBuffer = this.get('scrollBuffer');

    if (scrollbar.isScrolledToBottom(scrollBuffer, scrollOffset)) {
      debounce(this, this.sendScrolledToBottom, 100);
    }
  },

  sendScrolledToBottom() {
    this.sendAction('onScrolledToBottom');
  },

  sendScroll(event, scrollOffset) {
    if (this.get('onScroll')) {
      deprecate('Using the `onScroll` callback has deprecated in favor of the explicit `onScrollX` and `onScrollY callbacks');
      this.sendAction('onScroll', scrollOffset, event);
    }
  },

  resizeScrollbar() {
    this.createScrollbarAndShowIfNecessary();
  },

  showScrollbar() {
    if (this.get('isDestroyed')) {
      return;
    }
    this.set('showHandle', true);

    if (!this.get('autoHide')) {
      return;
    }

    debounce(this, this.hideScrollbar, hideDelay);
  },

  hideScrollbar() {
    if (this.get('isDestroyed')) {
      return;
    }
    this.set('showHandle', false);
  },

  /**
   * Sets scrollTo{X,Y} by using the ratio of offset to content size.
   * Called when the handle in ember-scrollbar is dragged.
   *
   * @method updateScrollToProperty
   * @param scrollProp {String} String indicating the scrollTo attribute to be updated ('scrollToX'|'scrollToY')
   * @param dragPerc {Number} A Number from 0 - 1 indicating the position of the handle as percentage of the scrollbar
   * @param sizeAttr {String} String indicating the attribute used to get to the size of the content ('height'|'width')
   * @private
   */
  updateScrollToProperty(scrollProp, dragPerc, sizeAttr) {
    const srcollTo = dragPerc * this.contentSize(sizeAttr);
    this.set(scrollProp, srcollTo);
  },

  /**
   * Sets is{Horizontal,Vertical}Dragging to true or false when the handle starts or ends dragging
   *
   * @method toggleDraggingBoundary
   * @param isDraggingProp 'isHorizontalDragging' or 'isVerticalDragging'
   * @param startOrEnd true if starting to drag, false if ending
   * @private
   */
  toggleDraggingBoundary(isDraggingProp, startOrEnd) {
    this.set(isDraggingProp, startOrEnd);
  },

  /**
   * Jumps a page because user clicked on scroll bar not scroll bar handle.
   *
   * @method jumpScroll
   * @param jumpPositive if true the user clicked between the handle and the end, if false, the user clicked between the
   *  anchor and the handle
   * @param scrollToProp 'scrollToX' or 'scrollToY'
   * @param sizeAttr 'width' or 'height'
   * @private
   */
  jumpScroll(jumpPositive, scrollToProp, sizeAttr) {
    const scrollOffset = this.get(scrollToProp);
    let jumpAmt = PAGE_JUMP_MULTIPLE * this.contentSize(sizeAttr);
    let scrollPos = jumpPositive ? scrollOffset - jumpAmt : scrollOffset + jumpAmt;
    this.set(scrollToProp, scrollPos);
  },


  actions: {

    /**
     * Update action should be called when size of the scroll area changes
     */
    recalculate() {
      // TODO this is effectively the same as `update`, except for update returns the passed in value. Keep one, and rename `resizeScrollbar` to be clear.
      this.resizeScrollbar();
    },

    /**
     * Can be called when scrollbars change as a result of value change,
     *
     * for example
     * ```
     * {{#as-scrollable as |scrollbar|}}
     *   {{#each (compute scrollbar.update rows) as |row|}}
     *     {{row.title}}
     *   {{/each}}
     * {{/as-scrollable}}
     * ```
     */
    update(value) {
      scheduleOnce('afterRender', this, this.resizeScrollbar);
      return value;
    },

    /**
     * Scroll Top action should be called when when the scroll area should be scrolled top manually
     */
    scrollTop() {
      // TODO some might expect the `scrollToY` action to be called here
      this.set('scrollToY', 0);
    },
    scrolled() {
      scheduleOnce('afterRender', this, 'scrolled', ...arguments);
    },
    horizontalDrag(dragPerc) {
      scheduleOnce('afterRender', this, 'updateScrollToProperty', 'scrollToX', dragPerc, 'width');
    },
    verticalDrag(dragPerc) {
      scheduleOnce('afterRender', this, 'updateScrollToProperty', 'scrollToY', dragPerc, 'height');
    },
    horizontalJumpTo(jumpPositive) {
      this.jumpScroll(jumpPositive, 'scrollToX', 'width');
    },
    verticalJumpTo(jumpPositive) {
      this.jumpScroll(jumpPositive, 'scrollToY', 'height');
    },
    horizontalDragBoundary(isStart) {
      this.toggleDraggingBoundary('isHorizontalDragging', isStart);
    },
    verticalBoundaryEvent(isStart) {
      this.toggleDraggingBoundary('isVerticalDragging', isStart);
    }
  }
});
