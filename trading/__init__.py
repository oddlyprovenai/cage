"""Cage trading agent: real public data, deterministic decisions, and SIMULATED (paper) execution.

Real money is not enabled by default: `broker.RealBroker` refuses unless configured. Switching to real requires an explicit
decision by the user, own API keys, and confirming each order; none of that exists in this module by default.
"""
