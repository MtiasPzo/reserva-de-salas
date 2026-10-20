"""Genera capturas de pantalla de la aplicación para el informe (requiere servidor en marcha).
Uso: python3 scripts/capturas.py http://localhost:3000 carpeta_salida
"""
import sys, os
from playwright.sync_api import sync_playwright

BASE = sys.argv[1] if len(sys.argv) > 1 else 'http://localhost:3000'
OUT = sys.argv[2] if len(sys.argv) > 2 else 'capturas'
os.makedirs(OUT, exist_ok=True)
errores = []

def login(page, correo):
    page.goto(BASE + '/')
    page.wait_for_selector('#form-login', state='visible')
    page.fill('#login-correo', correo)
    page.fill('#login-pass', 'Reserva2026!')
    page.click('#form-login button[type=submit]')
    page.wait_for_selector('#view-app', state='visible')
    page.wait_for_timeout(700)

with sync_playwright() as p:
    b = p.chromium.launch()
    for tema in ['light', 'dark']:
        ctx = b.new_context(viewport={'width': 1440, 'height': 960}, color_scheme=tema, device_scale_factor=1)
        page = ctx.new_page()
        page.on('pageerror', lambda e: errores.append(str(e)))
        page.on('console', lambda m: errores.append(m.text) if m.type == 'error' else None)
        page.goto(BASE + '/')
        page.wait_for_selector('#form-login', state='visible')
        page.wait_for_timeout(500)
        page.screenshot(path=f'{OUT}/01_login_{tema}.png')
        login(page, 'ana.soto@inacapmail.cl')
        # Seleccionar bloque libre y mostrar validación
        page.click('.slot:not([disabled]) >> nth=' + ('60' if tema == 'light' else '150'), force=True)
        page.wait_for_timeout(600)
        page.screenshot(path=f'{OUT}/02_calendario_{tema}.png')
        if tema == 'light':
            # Conflicto HU07: forzar el horario de una reserva existente
            page.click('.blk >> nth=0')
            page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/03_detalle_ocupado.png')
            page.click('[data-close]')
            # crear reserva
            page.fill('#r-motivo', 'Estudio grupal de Metodología Ágil')
            page.fill('#r-asistentes', '4')
            page.click('#r-submit')
            page.wait_for_selector('.voucher', timeout=5000)
            page.wait_for_timeout(300)
            page.screenshot(path=f'{OUT}/04_confirmacion.png')
            page.click('[data-close]')
            # conflicto: mismo horario de nuevo
            page.fill('#r-motivo', 'Intento duplicado')
            page.wait_for_timeout(500)
            page.click('#r-submit')
            page.wait_for_timeout(600)
            page.locator('.ticket').screenshot(path=f'{OUT}/05_conflicto.png')
            page.click('[data-nav=mias]')
            page.wait_for_timeout(600)
            page.screenshot(path=f'{OUT}/06_mis_reservas.png')
            page.click('#btn-logout')
            login(page, 'pfernandez@inacap.cl')
            page.click('[data-nav=docente]')
            page.select_option('#d-recurso', '1')
            page.fill('#d-motivo', 'Taller de Programación — sección 2')
            page.select_option('#d-semanas', '6')
            page.select_option('#d-inicio', '14:00')
            page.select_option('#d-fin', '15:30')
            page.check('#d-prioridad')
            page.click('#d-simular')
            page.wait_for_timeout(700)
            page.screenshot(path=f'{OUT}/07_docente.png')
            page.click('#btn-logout')
            login(page, 'admin@inacap.cl')
            page.click('[data-nav=admin]')
            page.wait_for_timeout(800)
            page.screenshot(path=f'{OUT}/08_admin.png', full_page=True)
            page.click('[data-nav=salas]')
            page.wait_for_timeout(600)
            page.screenshot(path=f'{OUT}/09_salas.png')
            page.click('#btn-nueva-sala')
            page.wait_for_timeout(500)
            page.screenshot(path=f'{OUT}/10_form_sala.png')
        else:
            page.click('[data-nav=mias]')
            page.wait_for_timeout(500)
            page.screenshot(path=f'{OUT}/06_mis_reservas_dark.png')
        ctx.close()
    # Móvil
    ctx = b.new_context(viewport={'width': 400, 'height': 860}, color_scheme='light', device_scale_factor=2)
    page = ctx.new_page()
    login(page, 'diego.munoz@inacapmail.cl')
    page.screenshot(path=f'{OUT}/11_movil.png')
    w = page.evaluate('document.documentElement.scrollWidth')
    print('ancho movil', w)
    ctx.close()
    b.close()
print('errores consola:', errores)
