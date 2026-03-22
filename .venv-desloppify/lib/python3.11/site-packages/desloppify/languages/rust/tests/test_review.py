"""Tests for Rust review helpers."""

from __future__ import annotations

from desloppify.languages.rust.review import api_surface, module_patterns


def test_module_patterns_marks_public_surface_and_panic_paths():
    content = """
use crate::api::Client;

pub trait Render {
    fn render(&self);
}

pub struct Stream;

impl Iterator for Stream {
    type Item = usize;
    fn next(&mut self) -> Option<Self::Item> { None }
}

pub fn render() {
    panic!("boom");
}
"""

    patterns = module_patterns(content)

    assert patterns == [
        "use_declarations",
        "public_traits",
        "std_trait_impls",
        "panic_paths",
    ]


def test_api_surface_collects_public_items_and_trait_impls():
    file_contents = {
        "src/lib.rs": """
pub struct Client;
pub enum State { Ready }
pub fn render() {}

impl Iterator for Client {
    type Item = usize;
    fn next(&mut self) -> Option<Self::Item> { None }
}
"""
    }

    surface = api_surface(file_contents)

    assert surface == {
        "public_types": ["Client", "State"],
        "public_functions": ["render"],
        "trait_impls": ["Client::Iterator"],
    }
