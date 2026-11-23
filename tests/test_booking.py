"""The booking-link finder, on HTML snippets like the ones restaurant websites use. No network."""
import booking


def test_opentable_profile_link():
    html = '<a href="https://www.opentable.com/r/port-union-reservations-chicago?ref=1">Reserve</a>'
    assert booking.find_link(html) == ("OpenTable", "https://www.opentable.com/r/port-union-reservations-chicago")


def test_opentable_restref_keeps_only_the_restaurant_id():
    html = 'href="https://www.opentable.com/restref/client/?lang=en-US&amp;ot_source=site&amp;restref=22327"'
    assert booking.find_link(html) == ("OpenTable", "https://www.opentable.com/restref/client/?restref=22327")


def test_opentable_widget_script():
    html = '<script src="//www.opentable.com/widget/reservation/loader?rid=38575&type=standard"></script>'
    assert booking.find_link(html) == ("OpenTable", "https://www.opentable.com/restref/client/?rid=38575")


def test_resy_short_city_link_becomes_venue_page():
    assert booking.find_link("https://resy.com/cities/chi/monteverde") == ("Resy", "https://resy.com/cities/chi/venues/monteverde")


def test_sevenrooms_explore_link_becomes_reservations_page():
    assert booking.find_link('"http://www.sevenrooms.com/explore/elinas"') == ("SevenRooms", "https://www.sevenrooms.com/reservations/elinas")


def test_platform_branding_links_are_not_venues():
    html = '<a href="https://www.exploretock.com/tock">Powered by Tock</a> <a href="https://resy.com/cities/chicago-il/search">'
    assert booking.find_link(html) is None
    assert booking.find_link(html + '<a href="https://www.exploretock.com/handlebar">') == ("Tock", "https://www.exploretock.com/handlebar")


def test_no_booking_link():
    assert booking.find_link('<a href="/menu">Menu</a> <a href="https://instagram.com/x">IG</a>') is None
