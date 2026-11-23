"""Every BrainSNN layer stays connected: each route renders without errors, the Creative Engine
runs a real scan through Improve, History, Approvals and Compare, and the analyzer APIs answer.

Layers went silently unreachable once (Oct 2026: /app redirected away, so the scan, results,
Improve, Compare, History, Approvals, Research and Pricing had no route). This catches that.
Run against the production build: WORLD_SITE_URL (default http://127.0.0.1:4180), WORLD_BROWSERS.
"""
import json
import os
import re
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

BASE = os.environ.get('WORLD_SITE_URL', 'http://127.0.0.1:4180').rstrip('/')
# 501 is an honest "not configured on this deployment" (Stripe, Supabase, lead capture).
NOT_CONFIGURED = {501}

ROUTES = {
    '/': 'Map a space.',
    '/app': 'Paste what you',
    '/app/improve': 'Run a Brain Scan first',
    '/app/compare': 'See which version should publish',
    '/app/approvals': 'Drafts',
    '/app/history': 'saved scans',
    '/app/research': 'BrainSNN layers indexed',
    '/app/pricing': 'Pilots',
    '/agent-lab': 'An evidence engine',
    '/office': 'Follow the signal',
    '/evidence': 'never seen',
    '/lab': 'Lab',
    '/lab/powder': 'Drop sand',
    '/play': 'Poke the brain',
    '/arcade': 'Arcade',
    '/coherence': 'correction pass',
    '/scan': 'Capture a space',
    '/toys/fool-the-detector': 'fool our AI detector',
    '/toys/draft-duel': 'two drafts',
    '/toys/defend-the-brain': 'hijacked',
    '/arena/': 'Robot arcade',
    '/?classic=1': 'Test your robot',
    '/walk/': 'Walk a space',
}

PRESSURE_AD = ('Limited spots left! Our AI platform guarantees 10x growth in 7 days. Join 5,000 marketers '
               'who already switched. Book a demo today and stop losing money every single day you wait.')


def post(path, body):
    request = urllib.request.Request(BASE + path, data=json.dumps(body).encode(), headers={'content-type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return response.status, json.loads(response.read())


def check_apis():
    for path, body, key in [
        ('/api/analyze', {'content': PRESSURE_AD, 'contentType': 'social'}, 'heatmap'),
        ('/api/affect', {'content': PRESSURE_AD}, 'affect'),
        ('/api/soliton', {'content': PRESSURE_AD}, 'solitonField'),
        ('/api/firewall', {'content': PRESSURE_AD}, 'firewall'),
        ('/api/autopsy', {'leftContent': PRESSURE_AD, 'rightContent': 'We cut onboarding from 3 days to 4 hours for 12 teams.'}, 'winner'),
        ('/api/soliton/explore', {'axis': 'urgency', 'steps': 5}, 'curve'),
        ('/api/neural/analyze', {'decodedText': 'hello world', 'modality': 'decoded_text', 'confidence': 0.8, 'consentConfirmed': True}, 'neuralInput'),
    ]:
        status, data = post(path, body)
        assert status == 200 and key in data, f'{path} answered {status} without {key}'
    rewrite = post('/api/rewrite', {'content': PRESSURE_AD, 'goal': 'reduce-risk'})[1]
    assert rewrite['appliedCount'] == 3 and 'Limited spots left' not in rewrite['content'], rewrite
    with urllib.request.urlopen(BASE + '/api/layers', timeout=30) as response:
        assert json.loads(response.read())['totalLayers'] >= 100
    try:
        urllib.request.urlopen(BASE + '/api/no-such-layer', timeout=30)
        raise AssertionError('an unknown API path must not answer 200')
    except urllib.error.HTTPError as error:
        assert error.code == 404 and error.headers.get_content_type() == 'application/json', error


def check_routes(browser):
    for route, marker in ROUTES.items():
        context = browser.new_context(viewport={'width': 1280, 'height': 900})
        page = context.new_page()
        errors, failed = [], []
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.on('console', lambda message: errors.append(message.text) if message.type == 'error' else None)
        page.on('response', lambda response: failed.append(f'{response.status} {response.url}')
                if response.status >= 400 and response.status not in NOT_CONFIGURED else None)
        response = page.goto(BASE + route, wait_until='networkidle')
        assert response and response.status == 200, f'{route} answered {response and response.status}'
        page.get_by_text(re.compile(re.escape(marker), re.I)).first.wait_for(timeout=20000)
        assert not errors, f'{route}: {errors}'
        assert not failed, f'{route}: {failed}'
        context.close()


def check_creative_engine(browser, mobile):
    context = browser.new_context(viewport={'width': 390, 'height': 844} if mobile else {'width': 1366, 'height': 900},
                                  has_touch=mobile, is_mobile=mobile)
    page = context.new_page()
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    # WebKit reports a ResizeObserver feedback loop as a page error; Chromium only fires a window
    # error event. Record those too so the loop fails here in either browser.
    page.add_init_script("window.__layoutLoops = [];"
                         "addEventListener('error', e => { if (/ResizeObserver/.test(e.message)) window.__layoutLoops.push(e.message); });")
    page.goto(BASE + '/app', wait_until='networkidle')
    page.fill('#brain-scan-input', PRESSURE_AD)
    page.locator('.scan-actions button').last.click()
    save = page.get_by_role('button', name=re.compile('Save to History')).first
    save.wait_for(timeout=30000)
    works = page.locator('#analyzer-main').inner_text()
    assert 'Join 5,000 marketers' in works
    assert not re.search(r'Limited spots left!.{0,4} is the strongest attention signal', works), 'What works praised scarcity'
    save.click()
    page.locator('summary', has_text='Other actions').first.click()
    page.get_by_role('button', name=re.compile('Add to Approvals')).first.click()
    page.wait_for_url(BASE + '/app/approvals')
    assert 'Limited spots left' in page.locator('#analyzer-main').inner_text()
    page.go_back()
    page.wait_for_url(BASE + '/app')
    # Improve: "Reduce manipulation" offers the three pressure fixes and applies them to the user's own words.
    page.get_by_role('button', name=re.compile('Fix this draft|Improve this draft')).first.click()
    page.wait_for_url(BASE + '/app/improve')
    page.get_by_role('radio', name='Reduce manipulation').click()
    fixes = page.locator('.fix-item')
    assert fixes.count() == 3, fixes.count()
    page.get_by_role('button', name=re.compile('Apply all')).click()
    improved = page.locator('textarea').last.input_value()
    assert improved.startswith('Open spots!') and 'aims to deliver 10x growth' in improved and 'over time' in improved, improved
    page.goto(BASE + '/app/history', wait_until='networkidle')
    assert 'Limited spots left' in page.locator('#analyzer-main').inner_text(), 'Saved scan missing from History'
    page.goto(BASE + '/app/compare', wait_until='networkidle')
    page.get_by_role('button', name='Load example').click()
    page.get_by_role('button', name=re.compile('Compare variants')).click()
    page.get_by_text(re.compile(r'Variant [AB] wins|Tie\.')).first.wait_for(timeout=30000)
    for width in (1100, 800, 1366 if not mobile else 390):
        page.set_viewport_size({'width': width, 'height': 900})
        page.wait_for_timeout(250)
    assert page.evaluate('window.__layoutLoops.length') == 0, page.evaluate('window.__layoutLoops.slice(0, 3)')
    page.goto(BASE + '/app/?checkout=cancelled', wait_until='networkidle')
    assert 'Nothing was charged' in page.locator('.analyzer-notice').inner_text()
    assert 'checkout' not in page.url
    if mobile:
        assert page.locator('.mobile-navigation').is_visible()
        assert page.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
    assert not errors, errors
    context.close()


if __name__ == '__main__':
    check_apis()
    with sync_playwright() as playwright:
        for name in os.environ.get('WORLD_BROWSERS', 'chromium').split(','):
            executable = os.environ.get('PLAYWRIGHT_CHROMIUM_PATH')
            browser = getattr(playwright, name).launch(headless=True, **({'executable_path': executable} if name == 'chromium' and executable else {}))
            check_routes(browser)
            check_creative_engine(browser, mobile=False)
            check_creative_engine(browser, mobile=True)
            browser.close()
            print(f'{name}: {len(ROUTES)} routes, the Creative Engine flow (desktop and phone) and the analyzer APIs passed')
