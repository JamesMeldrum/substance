//
//  MainView.m
//  substance
//
//  Created by Oliver Buchtala on 9/28/12.
//
//

#import "MainView.h"
#import <WebKit/WebFrame.h>

@implementation MainView

-(void) setWebView: (WebView*) webView
{
  m_webView = webView;
}

- (BOOL)acceptsFirstResponder {
    return YES;
}

- (void) keyDown:(NSEvent *)theEvent {
  // Note: this consumes all key events that have not been handled
  //       by within the child views (e.g. WebView)
  //       if some application wide key handling is necessary, handle the keyEvent
  if([theEvent modifierFlags] & NSCommandKeyMask) {

    // Reload on Command + r
    if([[theEvent characters] characterAtIndex:0] == 'r') {
      [m_webView reload: self];
    }
  }

}

@end

@implementation WebViewExtension

- (id) init: (WebView *) webView
{
  m_webView = webView;
  for (int idx=0; idx < 5; ++idx) {
    m_extensions[idx] = 0;
  }

  return self;
}

- (WebView*) getWebView
{
  return m_webView;
}

- (void) updateJSEngine
{
  JSGlobalContextRef context = [[m_webView mainFrame] globalContext];

  for (int idx=0; idx < 5; ++idx) {
    if(m_extensions[idx] != 0) {
      m_extensions[idx](context);
    }
  }
}

- (void) addExtension:(JSCExtension) extension
{
  for (int idx=0; idx < 5; ++idx) {
    if(m_extensions[idx] == 0) {
      m_extensions[idx] = extension;
      break;
    }
  }
}

@end

@implementation WebViewLoadDelegate

- (id) init:(WebViewExtension *)webExtension
{
  [super init];
  m_webExtension = webExtension;
  return self;
}

/*
- (void) webView:(WebView *)webView didClearWindowObject:(WebScriptObject *)windowObject forFrame:(WebFrame *)frame
{
  [m_webExtension updateJSEngine];
}
 */

- (void) webView:(WebView *)sender didCommitLoadForFrame:(WebFrame *)frame
{
  [m_webExtension updateJSEngine];
}

@end
